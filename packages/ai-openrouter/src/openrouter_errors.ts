/**
 * @module OpenRouterErrors
 * @path packages/ai-openrouter/src/openrouter_errors.ts
 * @related-files ["packages/ai-openrouter/src/openrouter_provider.ts", "packages/ai-openrouter/src/constants.ts", "packages/ai/src/provider_common_utils.ts"]
 * @architectural-layer AI
 * @dependencies ["zod", "@exaix/ai/providers", "@exaix/ai/provider_common_utils.ts", "@exaix/core"]
 * @description Maps an OpenRouter error response to one typed error. The mapper keeps the upstream
 * reason (error type, provider name and provider code) in the message and never copies the verbatim
 * `metadata.raw` payload or the flagged input. Statuses outside the documented table keep the shared error.
 */

import { z } from "zod";
import {
  AuthenticationError,
  ConnectionError,
  ModelProviderError,
  RateLimitError,
  TimeoutError,
} from "@exaix/ai/providers";
import { HTTP_FORBIDDEN, HTTP_TOO_MANY_REQUESTS, HTTP_UNAUTHORIZED, type JSONValue } from "@exaix/core";
import type { Opt, Reason } from "@exaix/core/types";
import {
  OPENROUTER_ERROR_FIELD_MAX_CHARS,
  OPENROUTER_HTTP_STATUS,
  OPENROUTER_IN_FLIGHT_BUDGET_LIMIT_SOURCE,
  OPENROUTER_MS_PER_SECOND,
  OPENROUTER_RETRY_AFTER_MAX_MS,
  OPENROUTER_ROUTING_REFUSAL_PATTERN,
  PROVIDER_OPENROUTER,
} from "./constants.ts";

/** Budget fields that OpenRouter reports on a 402 or on a spent-budget 403. */
export interface IOpenRouterBillingDetail {
  limitSource?: string;
  limitUsd?: number;
  spendUsd?: number;
  resetsAt?: string;
  scope?: string;
  /** Wait that the Retry-After header asked for, set only for the in-flight budget limit. */
  retryAfterMs?: number;
}

const RETRY_AFTER_HEADER = "Retry-After";
const DIGITS_ONLY = /^\d+$/;
const CONTROL_CHARACTERS = /\p{Cc}/gu;
const HTTP_BAD_REQUEST = 400;

/** Insufficient credits or a spent budget. Retrying the same request cannot succeed. */
export class OpenRouterBillingError extends ModelProviderError {
  readonly limitSource?: string;
  readonly limitUsd?: number;
  readonly spendUsd?: number;
  readonly resetsAt?: string;
  readonly scope?: string;
  readonly retryAfterMs?: number;

  constructor(message: string, provider: string, detail: IOpenRouterBillingDetail) {
    super(message, provider);
    this.name = "OpenRouterBillingError";
    this.limitSource = detail.limitSource;
    this.limitUsd = detail.limitUsd;
    this.spendUsd = detail.spendUsd;
    this.resetsAt = detail.resetsAt;
    this.scope = detail.scope;
    this.retryAfterMs = detail.retryAfterMs;
    Object.setPrototypeOf(this, OpenRouterBillingError.prototype);
  }
}

/** A guardrail, moderation or content policy block. The request content is not exposed here. */
export class OpenRouterGuardrailError extends ModelProviderError {
  constructor(message: string, provider: string) {
    super(message, provider);
    this.name = "OpenRouterGuardrailError";
    Object.setPrototypeOf(this, OpenRouterGuardrailError.prototype);
  }
}

/** No endpoint can serve the requested parameters, so the routing layer refused the request. */
export class OpenRouterRoutingError extends ModelProviderError {
  constructor(message: string, provider: string) {
    super(message, provider);
    this.name = "OpenRouterRoutingError";
    Object.setPrototypeOf(this, OpenRouterRoutingError.prototype);
  }
}

/** A 429 that keeps the wait OpenRouter asked for. It stays retryable like the shared rate limit error. */
export class OpenRouterRateLimitError extends RateLimitError {
  readonly retryAfterMs?: number;

  constructor(provider: string, message: string, retryAfterMs?: Opt<number, Reason.OptionalContext>) {
    super(provider, message);
    this.name = "OpenRouterRateLimitError";
    this.retryAfterMs = retryAfterMs;
    Object.setPrototypeOf(this, OpenRouterRateLimitError.prototype);
  }
}

/** The response ended at the token limit. The cap was spent before an answer began, or the answer is incomplete. */
export class OpenRouterTruncationError extends ModelProviderError {
  readonly completionTokens: Opt<number, Reason.OptionalContext>;
  readonly reasoningTokens: Opt<number, Reason.OptionalContext>;

  constructor(
    provider: string,
    completionTokens?: Opt<number, Reason.OptionalContext>,
    reasoningTokens?: Opt<number, Reason.OptionalContext>,
    hadPartialContent = false,
  ) {
    super(
      `OpenRouter response was cut off at the max_tokens limit ${
        hadPartialContent ? "before the answer was complete" : "with no content"
      } (finish_reason=length, ` +
        `completion_tokens=${completionTokens ?? "unknown"}, reasoning_tokens=${reasoningTokens ?? "unknown"}). ` +
        `Raise max_tokens or lower the reasoning effort.`,
      provider,
    );
    this.name = "OpenRouterTruncationError";
    this.completionTokens = completionTokens;
    this.reasoningTokens = reasoningTokens;
    Object.setPrototypeOf(this, OpenRouterTruncationError.prototype);
  }
}

const UpstreamMarker = z.json().optional();
const UpstreamString = z.string().optional().catch(undefined);
const UpstreamScalar = z.union([z.string(), z.number()]).optional().catch(undefined);
const UpstreamNumber = z.number().optional().catch(undefined);

/** Documented fields plus the routing markers seen on live 404 bodies. Markers are read for presence only. */
const OpenRouterErrorEnvelopeSchema = z.object({
  error: z.object({
    message: UpstreamString,
    metadata: z.object({
      error_type: UpstreamString,
      provider_name: UpstreamString,
      provider_code: UpstreamScalar,
      limit_source: UpstreamString,
      limit_usd: UpstreamNumber,
      spend_usd: UpstreamNumber,
      resets_at: UpstreamString,
      scope: UpstreamString,
      failed_routing_step: UpstreamString,
      routing_funnel: UpstreamMarker,
      reasons: UpstreamMarker,
      flagged_input: UpstreamMarker,
      patterns: UpstreamMarker,
    }).optional().catch(undefined),
  }),
});

interface IErrorDetail {
  message?: string;
  errorType?: string;
  providerName?: string;
  providerCode?: string;
  routingStep?: string;
  billing: IOpenRouterBillingDetail;
  hasGuardrailMarker: boolean;
  hasRoutingMarker: boolean;
}

function cleanField(value: Opt<string | number, Reason.OptionalInput>): string | undefined {
  if (value === undefined) return undefined;
  const cleaned = String(value).replace(CONTROL_CHARACTERS, " ").trim().slice(0, OPENROUTER_ERROR_FIELD_MAX_CHARS);
  return cleaned.length > 0 ? cleaned : undefined;
}

function isPresent(markers: Array<z.infer<typeof UpstreamMarker>>): boolean {
  return markers.some((marker) => marker !== undefined && marker !== null);
}

function parseDetail(bodyText: string): IErrorDetail | undefined {
  let json: JSONValue;
  try {
    json = JSON.parse(bodyText);
  } catch {
    return undefined;
  }
  const parsed = OpenRouterErrorEnvelopeSchema.safeParse(json);
  if (!parsed.success) return undefined;
  const { message, metadata } = parsed.data.error;
  return {
    message: cleanField(message),
    errorType: cleanField(metadata?.error_type),
    providerName: cleanField(metadata?.provider_name),
    providerCode: cleanField(metadata?.provider_code),
    routingStep: cleanField(metadata?.failed_routing_step),
    billing: {
      limitSource: cleanField(metadata?.limit_source),
      limitUsd: metadata?.limit_usd,
      spendUsd: metadata?.spend_usd,
      resetsAt: cleanField(metadata?.resets_at),
      scope: cleanField(metadata?.scope),
    },
    hasGuardrailMarker: isPresent([metadata?.reasons, metadata?.flagged_input, metadata?.patterns]),
    hasRoutingMarker: isPresent([metadata?.failed_routing_step, metadata?.routing_funnel]),
  };
}

function describe(status: number, detail: IErrorDetail): string {
  const reason = detail.errorType ? `${detail.errorType}${detail.message ? ": " : ""}` : "";
  const head = [`HTTP ${status}`, `${reason}${detail.message ?? ""}`].filter((part) => part.length > 0).join(" ");
  const origin = [
    detail.providerName ? `provider=${detail.providerName}` : undefined,
    detail.providerCode ? `provider_code=${detail.providerCode}` : undefined,
    detail.routingStep ? `routing_step=${detail.routingStep}` : undefined,
  ].filter((part) => part !== undefined);
  return origin.length > 0 ? `${head} (${origin.join(", ")})` : head;
}

function parseRetryAfterMs(headers: Headers): number | undefined {
  const raw = headers.get(RETRY_AFTER_HEADER)?.trim();
  if (!raw) return undefined;
  let waitMs: number;
  if (DIGITS_ONLY.test(raw)) {
    waitMs = Number(raw) * OPENROUTER_MS_PER_SECOND;
  } else {
    const at = Date.parse(raw);
    if (Number.isNaN(at)) return undefined;
    waitMs = at - Date.now();
  }
  return Math.min(Math.max(waitMs, 0), OPENROUTER_RETRY_AFTER_MAX_MS);
}

function billingError(message: string, provider: string, detail: IErrorDetail, headers: Headers): Error {
  const inFlight = detail.billing.limitSource === OPENROUTER_IN_FLIGHT_BUDGET_LIMIT_SOURCE;
  return new OpenRouterBillingError(message, provider, {
    ...detail.billing,
    retryAfterMs: inFlight ? parseRetryAfterMs(headers) : undefined,
  });
}

function forbiddenError(message: string, provider: string, detail: IErrorDetail, headers: Headers): Error {
  if (detail.hasGuardrailMarker) return new OpenRouterGuardrailError(message, provider);
  if (detail.billing.limitSource !== undefined) return billingError(message, provider, detail, headers);
  return new AuthenticationError(provider, message);
}

function timeoutError(message: string, provider: string): Error {
  const error = new TimeoutError(provider, 0);
  error.message = message;
  return error;
}

/** Maps one OpenRouter error response. An unreadable body or an undocumented status keeps `fallback`. */
export function mapOpenRouterError(status: number, headers: Headers, bodyText: string, fallback: Error): Error {
  const detail = parseDetail(bodyText);
  if (!detail) return fallback;
  const provider = fallback instanceof ModelProviderError ? fallback.provider : PROVIDER_OPENROUTER;
  const message = describe(status, detail);
  switch (status) {
    case HTTP_BAD_REQUEST:
      return new ModelProviderError(message, provider);
    case HTTP_UNAUTHORIZED:
      return new AuthenticationError(provider, message);
    case OPENROUTER_HTTP_STATUS.PAYMENT_REQUIRED:
      return billingError(message, provider, detail, headers);
    case HTTP_FORBIDDEN:
      return forbiddenError(message, provider, detail, headers);
    case OPENROUTER_HTTP_STATUS.NOT_FOUND:
      return detail.hasRoutingMarker || OPENROUTER_ROUTING_REFUSAL_PATTERN.test(detail.message ?? "")
        ? new OpenRouterRoutingError(message, provider)
        : new ModelProviderError(message, provider);
    case OPENROUTER_HTTP_STATUS.REQUEST_TIMEOUT:
      return timeoutError(message, provider);
    case HTTP_TOO_MANY_REQUESTS:
      return new OpenRouterRateLimitError(provider, message, parseRetryAfterMs(headers));
    case OPENROUTER_HTTP_STATUS.BAD_GATEWAY:
    case OPENROUTER_HTTP_STATUS.SERVICE_UNAVAILABLE:
      return new ConnectionError(provider, message);
    default:
      return fallback;
  }
}
