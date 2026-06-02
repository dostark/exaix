/**
 * @module OpenRouterProvider
 * @path packages/ai-openrouter/src/openrouter_provider.ts
 * @related-files ["packages/ai-openrouter/src/openrouter_factory.ts", "packages/ai-openrouter/src/constants.ts"]
 * @architectural-layer AI
 * @dependencies ["@exaix/ai/providers", "@exaix/ai/provider_common_utils.ts"]
 * @description OpenRouter provider over the OpenAI-compatible gateway. Reuses the shared
 * OpenAI request/response helpers and adds OpenRouter's HTTP-Referer / X-Title ranking headers.
 */

import {
  createOpenAIChatCompletionsRequestInit,
  extractOpenAIContent,
  type OpenAIResponse,
  performProviderCall,
  tokenMapperOpenAI,
} from "@exaix/ai/provider_common_utils.ts";
import { BaseProvider, type IBaseProviderOptions, type IGenerateResult } from "@exaix/ai/providers";
import type { IModelOptions } from "@exaix/ai/types.ts";
import {
  DEFAULT_OPENROUTER_ENDPOINT,
  DEFAULT_OPENROUTER_MODEL,
  DEFAULT_OPENROUTER_RETRY_BACKOFF_MS,
  DEFAULT_OPENROUTER_RETRY_MAX_ATTEMPTS,
  DEFAULT_OPENROUTER_TIMEOUT_MS,
  HTTP_REFERER_HEADER,
  OPENROUTER_DEFAULT_SITE_NAME,
  OPENROUTER_DEFAULT_SITE_URL,
  PROVIDER_OPENROUTER,
  X_TITLE_HEADER,
} from "./constants.ts";

/** Options for OpenRouterProvider. `siteName`/`siteUrl` populate OpenRouter ranking headers. */
export type OpenRouterProviderOptions = IBaseProviderOptions & {
  siteName?: string;
  siteUrl?: string;
};

/**
 * OpenRouterProvider implements IModelProvider over the OpenAI-compatible OpenRouter gateway.
 */
export class OpenRouterProvider extends BaseProvider {
  private readonly siteName: string;
  private readonly siteUrl: string;

  constructor(options: OpenRouterProviderOptions) {
    super(
      options,
      DEFAULT_OPENROUTER_MODEL,
      options.baseUrl || DEFAULT_OPENROUTER_ENDPOINT,
      options.timeoutMs || DEFAULT_OPENROUTER_TIMEOUT_MS,
      options.retryDelayMs || DEFAULT_OPENROUTER_RETRY_BACKOFF_MS,
      options.maxRetries || DEFAULT_OPENROUTER_RETRY_MAX_ATTEMPTS,
      PROVIDER_OPENROUTER,
    );
    this.siteName = options.siteName ?? OPENROUTER_DEFAULT_SITE_NAME;
    this.siteUrl = options.siteUrl ?? OPENROUTER_DEFAULT_SITE_URL;
  }

  protected override async attemptGenerate(prompt: string, options?: IModelOptions): Promise<IGenerateResult> {
    const init = createOpenAIChatCompletionsRequestInit(this.apiKey, this.model, prompt, options);
    const headers: Record<string, string> = {
      ...(init.headers as Record<string, string>),
      [HTTP_REFERER_HEADER]: this.siteUrl,
      [X_TITLE_HEADER]: this.siteName,
    };

    return await performProviderCall<OpenAIResponse>(this.baseUrl, { ...init, headers }, {
      id: this.id,
      maxAttempts: this.maxRetries,
      backoffBaseMs: this.retryDelayMs,
      timeoutMs: this.timeoutMs,
      logger: this.logger,
      tokenMapper: tokenMapperOpenAI(this.model),
      extractor: extractOpenAIContent,
    });
  }
}
