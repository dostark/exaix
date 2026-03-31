/**
 * @module OpenAIProvider
 * @path src/ai/providers/openai_provider.ts
 * @description IModelProvider implementation for OpenAI GPT models and compatible APIs.
 * @architectural-layer AI
 * * @related-files [src/ai/factories/openai_factory.ts]
 */
import { IModelOptions } from "../types.ts";
import {
  createOpenAIChatCompletionsRequestInit,
  type OpenAIResponse,
  performProviderCall,
  tokenMapperOpenAI,
} from "../provider_common_utils.ts";
import * as DEFAULTS from "../../shared/constants.ts";
import { BaseProvider, IBaseProviderOptions } from "./base_provider.ts";

/**
 * Options for OpenAIProvider
 */
export type OpenAIProviderOptions = IBaseProviderOptions;

/**
 * OpenAIProvider implements IModelProvider for OpenAI's GPT models.
 */
export class OpenAIProvider extends BaseProvider {
  /**
   * @param options.apiKey OpenAI API key
   * @param options.model Model name (default: gpt-5-mini)
   * @param options.id Optional provider id
   * @param options.logger Optional event logger
   * @param options.retryDelayMs Optional retry delay in ms (reads from config)
   * @param options.maxRetries Optional max retries (reads from config)
   * @param options.baseUrl Optional base URL (reads from config)
   * @param options.config Optional config object for endpoints and retry settings
   */
  constructor(options: OpenAIProviderOptions) {
    super(
      options,
      DEFAULTS.DEFAULT_OPENAI_MODEL,
      options.config?.ai_endpoints?.openai || DEFAULTS.DEFAULT_OPENAI_ENDPOINT,
      options.config?.ai_timeout?.providers?.openai || DEFAULTS.DEFAULT_OPENAI_TIMEOUT_MS,
      options.config?.ai_retry?.providers?.openai?.backoff_base_ms || DEFAULTS.DEFAULT_OPENAI_RETRY_BACKOFF_MS,
      options.config?.ai_retry?.providers?.openai?.max_attempts || DEFAULTS.DEFAULT_OPENAI_RETRY_MAX_ATTEMPTS,
      "openai",
    );
  }

  /**
   * Internal: attempt a single completion call.
   */
  protected override async attemptGenerate(prompt: string, options?: IModelOptions): Promise<string> {
    const data = await performProviderCall<OpenAIResponse>(
      this.baseUrl,
      createOpenAIChatCompletionsRequestInit(
        this.apiKey,
        this.model,
        prompt,
        options,
      ),
      {
        id: this.id,
        maxAttempts: this.maxRetries,
        backoffBaseMs: this.retryDelayMs,
        timeoutMs: this.timeoutMs,
        logger: this.logger,
        tokenMapper: tokenMapperOpenAI(this.model),
        extractor: (d: OpenAIResponse) => d.choices?.[0]?.message?.content ?? "",
      },
    );
    return data;
  }
}
