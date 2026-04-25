/**
 * @module AnthropicProvider
 * @path src/ai/providers/anthropic_provider.ts
 * @description IModelProvider implementation for Anthropic Claude models, supporting specialized headers and message formats.
 * @architectural-layer AI
 * * @related-files [src/ai/factories/anthropic_factory.ts]
 */
import type { IModelOptions } from "../types.ts";
import {
  type AnthropicResponse,
  extractAnthropicContent,
  performProviderCall,
  tokenMapperAnthropic,
} from "../provider_common_utils.ts";
import * as DEFAULTS from "@exaix/ai";
import { BaseProvider, type IBaseProviderOptions } from "./base_provider.ts";
import type { IGenerateResult } from "./common.ts";

/**
 * Options for AnthropicProvider
 */
export type AnthropicProviderOptions = IBaseProviderOptions;

/**
 * AnthropicProvider implements IModelProvider for Anthropic's Claude models.
 */
export class AnthropicProvider extends BaseProvider {
  private readonly apiVersion: string;

  /**
   * @param options.apiKey Anthropic API key
   * @param options.model Model name (default from config or constant)
   * @param options.id Optional provider id
   * @param options.logger Optional event logger
   * @param options.retryDelayMs Optional retry delay in ms (reads from config)
   * @param options.maxRetries Optional max retries (reads from config)
   * @param options.baseUrl Optional base URL (reads from config)
   * @param options.apiVersion Optional API version (reads from config)
   * @param options.config Optional config object for endpoints and retry settings
   */
  constructor(options: AnthropicProviderOptions & { apiVersion?: string }) {
    super(
      options,
      options.config?.ai_anthropic?.default_model || DEFAULTS.DEFAULT_ANTHROPIC_MODEL,
      options.config?.ai_endpoints?.anthropic || DEFAULTS.DEFAULT_ANTHROPIC_ENDPOINT,
      options.config?.ai_timeout?.providers?.anthropic || DEFAULTS.DEFAULT_ANTHROPIC_TIMEOUT_MS,
      options.config?.ai_retry?.providers?.anthropic?.backoff_base_ms || DEFAULTS.DEFAULT_ANTHROPIC_RETRY_BACKOFF_MS,
      options.config?.ai_retry?.providers?.anthropic?.max_attempts || DEFAULTS.DEFAULT_ANTHROPIC_RETRY_MAX_ATTEMPTS,
      DEFAULTS.PROVIDER_ANTHROPIC,
    );

    // Read API version from config or use default
    this.apiVersion = options.apiVersion ||
      options.config?.ai_anthropic?.api_version ||
      DEFAULTS.DEFAULT_ANTHROPIC_API_VERSION;
  }

  /**
   * Internal: attempt a single completion call.
   */
  protected override async attemptGenerate(prompt: string, options?: IModelOptions): Promise<IGenerateResult> {
    const data = await performProviderCall<AnthropicResponse>(this.baseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": this.apiVersion,
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: options?.max_tokens ?? DEFAULTS.DEFAULT_ANTHROPIC_MAX_TOKENS,
        messages: [{ role: "user", content: prompt }],
        temperature: options?.temperature,
        top_p: options?.top_p,
        stop_sequences: options?.stop,
      }),
    }, {
      id: this.id,
      maxAttempts: this.maxRetries,
      backoffBaseMs: this.retryDelayMs,
      timeoutMs: this.timeoutMs,
      logger: this.logger,
      tokenMapper: tokenMapperAnthropic(this.model),
      extractor: extractAnthropicContent,
    });
    return data;
  }
}
