/**
 * @module OpenAIPackageProvider
 * @path packages/ai-openai/src/openai_provider.ts
 * @description OpenAI GPT provider implementation owned by the @exaix/ai-openai package.
 * @architectural-layer AI
 * @related-files [packages/ai-openai/src/openai_factory.ts, packages/ai-openai/src/openai_provider.ts]
 */

import {
  DEFAULT_OPENAI_ENDPOINT,
  DEFAULT_OPENAI_MODEL,
  DEFAULT_OPENAI_RETRY_BACKOFF_MS,
  DEFAULT_OPENAI_RETRY_MAX_ATTEMPTS,
  DEFAULT_OPENAI_TIMEOUT_MS,
} from "./constants.ts";
import {
  createOpenAIChatCompletionsRequestInit,
  extractOpenAIContent,
  extractOpenAIToolCalls,
  type OpenAIResponse,
  performProviderCall,
  tokenMapperOpenAI,
} from "@exaix/ai/provider_common_utils.ts";
import { BaseProvider, type IBaseProviderOptions, type IGenerateResult } from "@exaix/ai/providers";
import type { IModelOptions } from "@exaix/ai/types.ts";
import type { Opt, Reason } from "@exaix/core/types";

/**
 * Options for OpenAIProvider.
 */
export type OpenAIProviderOptions = IBaseProviderOptions;

/**
 * OpenAIProvider implements IModelProvider for OpenAI-compatible GPT models.
 */
export class OpenAIProvider extends BaseProvider {
  constructor(options: OpenAIProviderOptions) {
    super({
      ...options,
      defaultModel: DEFAULT_OPENAI_MODEL,
      defaultEndpoint: options.config?.ai_endpoints?.openai || DEFAULT_OPENAI_ENDPOINT,
      defaultTimeout: options.config?.ai_timeout?.providers?.openai || DEFAULT_OPENAI_TIMEOUT_MS,
      defaultRetryDelay: options.config?.ai_retry?.providers?.openai?.backoff_base_ms ||
        DEFAULT_OPENAI_RETRY_BACKOFF_MS,
      defaultMaxRetries: options.config?.ai_retry?.providers?.openai?.max_attempts || DEFAULT_OPENAI_RETRY_MAX_ATTEMPTS,
    }, "openai");
  }

  protected override async attemptGenerate(
    prompt: string,
    options?: Opt<IModelOptions, Reason.OptionalInput>,
  ): Promise<IGenerateResult> {
    return await performProviderCall<OpenAIResponse>(
      this.baseUrl,
      createOpenAIChatCompletionsRequestInit(this.apiKey, this.model, prompt, options),
      {
        id: this.id,
        maxAttempts: this.maxRetries,
        backoffBaseMs: this.retryDelayMs,
        timeoutMs: this.timeoutMs,
        logger: this.logger,
        tokenMapper: tokenMapperOpenAI(this.model),
        extractor: extractOpenAIContent,
        toolCallExtractor: extractOpenAIToolCalls,
      },
    );
  }
}
