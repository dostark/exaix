/**
 * @module AnthropicPackageProvider
 * @path packages/ai-anthropic/src/anthropic_provider.ts
 * @description Anthropic Claude provider implementation owned by the @exaix/ai-anthropic package.
 * @architectural-layer AI
 * @related-files [packages/ai-anthropic/src/anthropic_factory.ts, packages/ai-anthropic/src/anthropic_provider.ts]
 */

import {
  ANTHROPIC_CACHE_CONTROL_EPHEMERAL,
  ANTHROPIC_CONTENT_TYPE_TEXT,
  DEFAULT_ANTHROPIC_API_VERSION,
  DEFAULT_ANTHROPIC_ENDPOINT,
  DEFAULT_ANTHROPIC_MAX_TOKENS,
  DEFAULT_ANTHROPIC_MODEL,
  DEFAULT_ANTHROPIC_RETRY_BACKOFF_MS,
  DEFAULT_ANTHROPIC_RETRY_MAX_ATTEMPTS,
  DEFAULT_ANTHROPIC_TIMEOUT_MS,
  PROVIDER_ANTHROPIC,
} from "./constants.ts";
import { AnthropicMessagesRequestSchema } from "./anthropic_request_schema.ts";
import {
  type AnthropicResponse,
  extractAnthropicContent,
  performProviderCall,
  tokenMapperAnthropic,
} from "@exaix/ai/provider_common_utils.ts";
import { BaseProvider, type IBaseProviderOptions, type IGenerateResult } from "@exaix/ai/providers";
import type { IModelOptions } from "@exaix/ai/types.ts";
import { PROVIDER_EVENT_REQUEST_DEBUG_DUMP } from "@exaix/core";
import { type Opt, type Reason, toSafeJson } from "@exaix/core/types";

/**
 * Options for AnthropicProvider.
 */
export type AnthropicProviderOptions = IBaseProviderOptions;

/**
 * AnthropicProvider implements IModelProvider for Anthropic's Claude models.
 */
export class AnthropicProvider extends BaseProvider {
  private readonly apiVersion: string;
  private readonly maxTokensDefault: number;

  constructor(options: AnthropicProviderOptions & { apiVersion?: string }) {
    super({
      ...options,
      defaultModel: options.config?.ai_anthropic?.default_model || DEFAULT_ANTHROPIC_MODEL,
      defaultEndpoint: options.config?.ai_endpoints?.anthropic || DEFAULT_ANTHROPIC_ENDPOINT,
      defaultTimeout: options.config?.ai_timeout?.providers?.anthropic || DEFAULT_ANTHROPIC_TIMEOUT_MS,
      defaultRetryDelay: options.config?.ai_retry?.providers?.anthropic?.backoff_base_ms ||
        DEFAULT_ANTHROPIC_RETRY_BACKOFF_MS,
      defaultMaxRetries: options.config?.ai_retry?.providers?.anthropic?.max_attempts ||
        DEFAULT_ANTHROPIC_RETRY_MAX_ATTEMPTS,
    }, PROVIDER_ANTHROPIC);

    this.apiVersion = options.apiVersion ||
      options.config?.ai_anthropic?.api_version ||
      DEFAULT_ANTHROPIC_API_VERSION;
    this.maxTokensDefault = options.config?.ai_anthropic?.max_tokens_default ||
      DEFAULT_ANTHROPIC_MAX_TOKENS;
  }

  protected override async attemptGenerate(
    prompt: string,
    options?: Opt<IModelOptions, Reason.OptionalInput>,
  ): Promise<IGenerateResult> {
    // Build messages with optional cache_control for cached sections
    const cachedSections = options?.cachedSections;
    const messages = (cachedSections && cachedSections.length > 0)
      ? [{
        role: "user" as const,
        content: [
          { type: ANTHROPIC_CONTENT_TYPE_TEXT, text: prompt },
        ].map((block, i) =>
          cachedSections.includes(i) ? { ...block, cache_control: { type: ANTHROPIC_CACHE_CONTROL_EPHEMERAL } } : block
        ),
      }]
      : [{ role: "user" as const, content: prompt }];

    const requestBody: AnthropicRequestBody = {
      model: this.model,
      max_tokens: options?.max_tokens ?? this.maxTokensDefault,
      messages,
      temperature: options?.temperature,
      top_p: options?.top_p,
      stop_sequences: options?.stop,
    };

    try {
      return await this.postMessages(requestBody);
    } catch (error) {
      // Newer models reject tuning parameters older models accept (observed live:
      // HTTP 400 "`temperature` is deprecated for this model." from claude-sonnet-5).
      // Strip the named parameter and retry once rather than failing the whole call
      // over a knob — self-healing for future parameter deprecations, no model list.
      if (!(error instanceof Error)) throw error;
      const strippedBody = stripRejectedParameter(requestBody, error);
      if (!strippedBody) throw error;
      return await this.postMessages(strippedBody);
    }
  }

  private async postMessages(requestBody: AnthropicRequestBody): Promise<IGenerateResult> {
    // Debug-level dump of the exact outbound JSON body, validated against the Messages API
    // request contract, so a live-provider failure (malformed request, unexpected 4xx) can be
    // diagnosed from the log without a separate network capture tool.
    if (this.logger) {
      const validation = AnthropicMessagesRequestSchema.safeParse(requestBody);
      void this.logger.debug(PROVIDER_EVENT_REQUEST_DEBUG_DUMP, this.id, {
        provider: "anthropic",
        request_body: toSafeJson(requestBody) ?? {},
        valid: validation.success,
        validation_errors: validation.success ? undefined : validation.error.flatten(),
      });
    }

    return await performProviderCall<AnthropicResponse>(this.baseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": this.apiVersion,
      },
      body: JSON.stringify(requestBody),
    }, {
      id: this.id,
      maxAttempts: this.maxRetries,
      backoffBaseMs: this.retryDelayMs,
      timeoutMs: this.timeoutMs,
      logger: this.logger,
      tokenMapper: tokenMapperAnthropic(this.model),
      extractor: extractAnthropicContent,
    });
  }
}

type AnthropicRequestMessage = {
  role: "user";
  content: string | Array<{ type: string; text: string; cache_control?: Opt<{ type: string }, Reason.OptionalInput> }>;
};

type AnthropicRequestBody = {
  model: string;
  max_tokens: number;
  messages: AnthropicRequestMessage[];
  temperature?: Opt<number, Reason.OptionalInput>;
  top_p?: Opt<number, Reason.OptionalInput>;
  stop_sequences?: Opt<string[], Reason.OptionalInput>;
};

/** Matches Anthropic's 400 wording when a request parameter is rejected for the model. */
const REJECTED_PARAM_PATTERN = /`(\w+)` is (?:deprecated|not supported)/;

/**
 * If `error` is an HTTP 400 naming a parameter this request actually sent as
 * deprecated/unsupported, return a copy of the body without that parameter; null otherwise.
 */
function stripRejectedParameter(
  requestBody: AnthropicRequestBody,
  error: Error,
): AnthropicRequestBody | null {
  if (!error.message.includes("HTTP 400")) return null;
  const match = error.message.match(REJECTED_PARAM_PATTERN);
  if (!match) return null;
  const param = match[1] as keyof AnthropicRequestBody;
  if (requestBody[param] === undefined) return null;
  const stripped = { ...requestBody };
  delete stripped[param];
  return stripped;
}
