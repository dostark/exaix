/**
 * @module OpenRouterModelCapabilities
 * @path packages/ai-openrouter/src/openrouter_model_capabilities.ts
 * @related-files ["packages/ai-openrouter/src/openrouter_provider.ts", "packages/ai-openrouter/src/openrouter_factory.ts", "packages/ai-openrouter/src/constants.ts"]
 * @architectural-layer AI
 * @dependencies ["zod", "@exaix/ai", "@exaix/core"]
 * @description Per-model capability lookup over the OpenRouter models endpoint. One snapshot of the catalog
 * is fetched, cached for a TTL, and shared by concurrent callers. A failed lookup never blocks a call. It
 * journals a typed event and the caller proceeds without capability data. The key goes only in the
 * Authorization header.
 */

import { z } from "zod";
import type { JSONValue } from "@exaix/core";
import { ProviderProtocolError } from "@exaix/ai/errors.ts";
import { readResponseText } from "@exaix/ai/provider_common_utils.ts";
import { DomainEventType, type IOpenRouterCapabilityLookupFailedPayload } from "@exaix/core/events";
import type { IEventLogger } from "@exaix/core/logger";
import type { Opt, Reason } from "@exaix/core/types";
import {
  DEFAULT_OPENROUTER_CAPABILITY_CACHE_TTL_MS,
  OPENROUTER_CAPABILITY_FAILURE_BACKOFF_MS,
  OPENROUTER_CAPABILITY_MAX_RESPONSE_BYTES,
  OPENROUTER_TOKENIZER_MODEL_MAP,
  OPENROUTER_TOKENS_PER_MTOK,
} from "./constants.ts";

/** What the provider needs to know about one model before it sends a request. */
export interface IOpenRouterModelEntry {
  id: string;
  contextLength?: number;
  pricing?: { inputPerMtok?: number; outputPerMtok?: number };
  supportedParameters: readonly string[];
  reasoning?: {
    mandatory: boolean;
    supportedEfforts: readonly string[];
    defaultEffort?: string;
    supportsMaxTokens: boolean;
  };
  tokenizer?: string;
}

/** The lookup that the provider consumes. The real class and test doubles both satisfy it. */
export interface IOpenRouterCapabilitySource {
  getEntry(model: string, traceId?: Opt<string, Reason.TraceAbsent>): Promise<IOpenRouterModelEntry | undefined>;
}

export interface IOpenRouterModelCapabilitiesOptions {
  apiKey: string;
  modelsUrl: string;
  providerId: string;
  timeoutMs: number;
  ttlMs?: number;
  failureBackoffMs?: number;
  maxResponseBytes?: number;
  logger?: IEventLogger;
  /** Clock in milliseconds. Tests inject one, so cache expiry needs no waiting. */
  now?: () => number;
}

const CHAT_COMPLETIONS_SUFFIX = /\/chat\/completions\/?$/;
const TRAILING_SLASHES = /\/+$/;
const MODELS_PATH = "/models";
const ERROR_NAME_TIMEOUT = "TimeoutError";
const ERROR_NAME_ABORT = "AbortError";
const TIMEOUT_ERROR_NAMES: ReadonlySet<string> = new Set([ERROR_NAME_TIMEOUT, ERROR_NAME_ABORT]);
const FAILURE_HTTP_ERROR = "http_error";
const FAILURE_PARSE_ERROR = "parse_error";
const FAILURE_TIMEOUT = "timeout";
const FAILURE_SIZE_LIMIT = "size_limit";

const ModelEntrySchema = z.object({
  id: z.string(),
  context_length: z.number().nullish(),
  supported_parameters: z.array(z.string()).nullish(),
  reasoning: z.object({
    mandatory: z.boolean().nullish(),
    supported_efforts: z.array(z.string()).nullish(),
    default_effort: z.string().nullish(),
    supports_max_tokens: z.boolean().nullish(),
  }).nullish(),
  architecture: z.object({ tokenizer: z.string().nullish() }).nullish(),
  pricing: z.object({
    prompt: z.string().nullish().catch(undefined),
    completion: z.string().nullish().catch(undefined),
  }).nullish().catch(undefined),
});

const CatalogEnvelopeSchema = z.object({ data: z.array(z.json()) });

type CatalogEntry = z.infer<typeof ModelEntrySchema>;

class CapabilityLookupFailure extends Error {
  constructor(
    readonly reason: IOpenRouterCapabilityLookupFailedPayload["reason"],
    readonly status?: Opt<number, Reason.OptionalContext>,
  ) {
    super(`OpenRouter capability lookup failed: ${reason}`);
  }
}

/** The models URL for a configured chat completions endpoint or API base. */
export function deriveOpenRouterModelsUrl(baseUrl: string): string {
  return `${baseUrl.replace(CHAT_COMPLETIONS_SUFFIX, "").replace(TRAILING_SLASHES, "")}${MODELS_PATH}`;
}

function toEntry(entry: CatalogEntry): IOpenRouterModelEntry {
  const reasoning = entry.reasoning;
  const inputPerMtok = parsePrice(entry.pricing?.prompt);
  const outputPerMtok = parsePrice(entry.pricing?.completion);
  return {
    id: entry.id,
    ...(entry.context_length != null ? { contextLength: entry.context_length } : {}),
    supportedParameters: entry.supported_parameters ?? [],
    ...(reasoning
      ? {
        reasoning: {
          mandatory: reasoning.mandatory === true,
          supportedEfforts: reasoning.supported_efforts ?? [],
          ...(reasoning.default_effort ? { defaultEffort: reasoning.default_effort } : {}),
          supportsMaxTokens: reasoning.supports_max_tokens === true,
        },
      }
      : {}),
    ...(entry.architecture?.tokenizer ? { tokenizer: entry.architecture.tokenizer } : {}),
    ...(inputPerMtok !== undefined || outputPerMtok !== undefined
      ? {
        pricing: {
          ...(inputPerMtok !== undefined ? { inputPerMtok } : {}),
          ...(outputPerMtok !== undefined ? { outputPerMtok } : {}),
        },
      }
      : {}),
  };
}

function parsePrice(value: Opt<string | null, Reason.OptionalInput>): number | undefined {
  if (!value?.trim()) return undefined;
  const price = Number(value) * OPENROUTER_TOKENS_PER_MTOK;
  return Number.isFinite(price) && price >= 0 ? price : undefined;
}

/** The estimator model that counts tokens for this model, or the configured id when no family maps. */
export function estimatorModelFor(
  entry: Opt<IOpenRouterModelEntry, Reason.OptionalContext>,
  configuredModel: string,
): string {
  const family = entry?.tokenizer;
  return family !== undefined && Object.hasOwn(OPENROUTER_TOKENIZER_MODEL_MAP, family)
    ? OPENROUTER_TOKENIZER_MODEL_MAP[family]
    : configuredModel;
}

interface ISnapshot {
  entries: ReadonlyMap<string, IOpenRouterModelEntry>;
  expiresAt: number;
}

export class OpenRouterModelCapabilities implements IOpenRouterCapabilitySource {
  private snapshot: ISnapshot | undefined;
  private inFlight: Promise<ISnapshot> | undefined;
  private readonly ttlMs: number;
  private readonly failureBackoffMs: number;
  private readonly maxResponseBytes: number;
  private readonly now: () => number;
  private logger: IEventLogger | undefined;

  constructor(private readonly options: IOpenRouterModelCapabilitiesOptions) {
    this.logger = options.logger;
    this.ttlMs = options.ttlMs ?? DEFAULT_OPENROUTER_CAPABILITY_CACHE_TTL_MS;
    this.failureBackoffMs = options.failureBackoffMs ?? OPENROUTER_CAPABILITY_FAILURE_BACKOFF_MS;
    this.maxResponseBytes = options.maxResponseBytes ?? OPENROUTER_CAPABILITY_MAX_RESPONSE_BYTES;
    this.now = options.now ?? Date.now;
  }

  /** Supplies the journal to a lookup built without one. An existing logger stays. */
  attachLogger(logger: IEventLogger): void {
    this.logger ??= logger;
  }

  async getEntry(model: string, traceId?: Opt<string, Reason.TraceAbsent>): Promise<IOpenRouterModelEntry | undefined> {
    const snapshot = await this.current(model, traceId);
    return snapshot.entries.get(model);
  }

  private async current(model: string, traceId: Opt<string, Reason.TraceAbsent>): Promise<ISnapshot> {
    if (this.snapshot && this.now() < this.snapshot.expiresAt) return this.snapshot;
    this.inFlight ??= this.refresh(model, traceId).finally(() => {
      this.inFlight = undefined;
    });
    return await this.inFlight;
  }

  private async refresh(model: string, traceId: Opt<string, Reason.TraceAbsent>): Promise<ISnapshot> {
    let next: ISnapshot;
    try {
      next = { entries: await this.fetchEntries(), expiresAt: this.now() + this.ttlMs };
    } catch (error) {
      const failure = error instanceof CapabilityLookupFailure
        ? error
        : new CapabilityLookupFailure(FAILURE_HTTP_ERROR);
      await this.journalFailure(model, failure, traceId);
      next = { entries: this.snapshot?.entries ?? new Map(), expiresAt: this.now() + this.failureBackoffMs };
    }
    this.snapshot = next;
    return next;
  }

  private async fetchEntries(): Promise<ReadonlyMap<string, IOpenRouterModelEntry>> {
    let response: Response;
    try {
      response = await fetch(this.options.modelsUrl, {
        headers: { "Authorization": `Bearer ${this.options.apiKey}` },
        signal: AbortSignal.timeout(this.options.timeoutMs),
      });
    } catch (error) {
      if (error instanceof Error && TIMEOUT_ERROR_NAMES.has(error.name)) {
        throw new CapabilityLookupFailure(FAILURE_TIMEOUT);
      }
      throw new CapabilityLookupFailure(FAILURE_HTTP_ERROR);
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new CapabilityLookupFailure(FAILURE_HTTP_ERROR, response.status);
    }
    const text = await this.readBody(response);
    return this.parse(text);
  }

  private async readBody(response: Response): Promise<string> {
    try {
      return await readResponseText(response, this.maxResponseBytes, this.options.providerId);
    } catch (error) {
      if (error instanceof ProviderProtocolError) throw new CapabilityLookupFailure(FAILURE_SIZE_LIMIT);
      throw new CapabilityLookupFailure(FAILURE_HTTP_ERROR);
    }
  }

  private parse(text: string): ReadonlyMap<string, IOpenRouterModelEntry> {
    let json: JSONValue;
    try {
      json = JSON.parse(text);
    } catch {
      throw new CapabilityLookupFailure(FAILURE_PARSE_ERROR);
    }
    const envelope = CatalogEnvelopeSchema.safeParse(json);
    if (!envelope.success) throw new CapabilityLookupFailure(FAILURE_PARSE_ERROR);
    const entries = new Map<string, IOpenRouterModelEntry>();
    for (const raw of envelope.data.data) {
      const parsed = ModelEntrySchema.safeParse(raw);
      if (parsed.success) entries.set(parsed.data.id, toEntry(parsed.data));
    }
    return entries;
  }

  private async journalFailure(
    model: string,
    failure: CapabilityLookupFailure,
    traceId: Opt<string, Reason.TraceAbsent>,
  ): Promise<void> {
    const payload: IOpenRouterCapabilityLookupFailedPayload = {
      model,
      reason: failure.reason,
      ...(failure.status !== undefined ? { status: failure.status } : {}),
    };
    await this.logger?.warn(
      DomainEventType.OpenRouterCapabilityLookupFailed,
      this.options.providerId,
      { ...payload },
      traceId,
    );
  }
}
