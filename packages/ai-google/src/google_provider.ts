/**
 * @module GooglePackageProvider
 * @path packages/ai-google/src/google_provider.ts
 * @description Google Gemini provider implementation owned by the @exaix/ai-google package.
 * @architectural-layer AI
 * @related-files [packages/ai-google/src/google_factory.ts, packages/ai-google/src/google_provider.ts]
 */

import {
  DEFAULT_GOOGLE_ENDPOINT,
  DEFAULT_GOOGLE_MODEL,
  DEFAULT_GOOGLE_RETRY_BACKOFF_MS,
  DEFAULT_GOOGLE_RETRY_MAX_ATTEMPTS,
  DEFAULT_GOOGLE_TIMEOUT_MS,
  PROVIDER_GOOGLE,
} from "./constants.ts";
import {
  extractGoogleContent,
  type GoogleResponse,
  performProviderCall,
  tokenMapperGoogle,
} from "@exaix/ai/provider_common_utils.ts";
import { BaseProvider, type IBaseProviderOptions, type IGenerateResult } from "@exaix/ai/providers";
import type { IModelOptions } from "@exaix/ai/types.ts";

/**
 * Options for GoogleProvider.
 */
export type GoogleProviderOptions = IBaseProviderOptions;

/**
 * GoogleProvider implements IModelProvider for Gemini models.
 */
export class GoogleProvider extends BaseProvider {
  constructor(options: GoogleProviderOptions) {
    super({
      ...options,
      defaultModel: DEFAULT_GOOGLE_MODEL,
      defaultEndpoint: options.config?.ai_endpoints?.google || DEFAULT_GOOGLE_ENDPOINT,
      defaultTimeout: options.config?.ai_timeout?.providers?.google || DEFAULT_GOOGLE_TIMEOUT_MS,
      defaultRetryDelay: options.config?.ai_retry?.providers?.["google"]?.backoff_base_ms ||
        DEFAULT_GOOGLE_RETRY_BACKOFF_MS,
      defaultMaxRetries: options.config?.ai_retry?.providers?.["google"]?.max_attempts ||
        DEFAULT_GOOGLE_RETRY_MAX_ATTEMPTS,
    }, PROVIDER_GOOGLE);
  }

  protected override async attemptGenerate(prompt: string, options?: IModelOptions): Promise<IGenerateResult> {
    const endpoint = `${this.baseUrl}/${this.model}:generateContent?key=${this.apiKey}`;

    return await performProviderCall<GoogleResponse>(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [{
          parts: [{ text: prompt }],
        }],
        generationConfig: {
          maxOutputTokens: options?.max_tokens,
          temperature: options?.temperature,
          topP: options?.top_p,
          stopSequences: options?.stop,
        },
      }),
    }, {
      id: this.id,
      maxAttempts: this.maxRetries,
      backoffBaseMs: this.retryDelayMs,
      timeoutMs: this.timeoutMs,
      logger: this.logger,
      tokenMapper: tokenMapperGoogle(this.model),
      extractor: extractGoogleContent,
    });
  }
}
