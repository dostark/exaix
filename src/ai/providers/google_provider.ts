/**
 * @module GoogleProvider
 * @path src/ai/providers/google_provider.ts
 * @description IModelProvider implementation for Google Gemini models, utilizing the Google Generative AI API.
 * @architectural-layer AI
 * * @related-files [src/ai/factories/google_factory.ts]
 */
import { IModelOptions } from "../types.ts";
import {
  extractGoogleContent,
  type GoogleResponse,
  performProviderCall,
  tokenMapperGoogle,
} from "../provider_common_utils.ts";
import * as DEFAULTS from "../../shared/constants.ts";
import { BaseProvider, IBaseProviderOptions } from "./base_provider.ts";

/**
 * Options for GoogleProvider
 */
export type GoogleProviderOptions = IBaseProviderOptions;

/**
 * GoogleProvider implements IModelProvider for Google's Gemini models.
 */
export class GoogleProvider extends BaseProvider {
  /**
   * @param options.apiKey Google API key
   * @param options.model Model name (default: gemini-pro)
   * @param options.id Optional provider id
   * @param options.logger Optional event logger
   * @param options.retryDelayMs Optional retry delay in ms (reads from config)
   * @param options.maxRetries Optional max retries (reads from config)
   * @param options.baseUrl Optional base URL (reads from config)
   * @param options.config Optional config object for endpoints and retry settings
   */
  constructor(options: GoogleProviderOptions) {
    super(
      options,
      DEFAULTS.DEFAULT_GOOGLE_MODEL,
      options.config?.ai_endpoints?.google || DEFAULTS.DEFAULT_GOOGLE_ENDPOINT,
      options.config?.ai_timeout?.providers?.google || DEFAULTS.DEFAULT_GOOGLE_TIMEOUT_MS,
      options.config?.ai_retry?.max_attempts || DEFAULTS.DEFAULT_AI_RETRY_BACKOFF_BASE_MS,
      options.config?.ai_retry?.max_attempts || DEFAULTS.DEFAULT_AI_RETRY_MAX_ATTEMPTS,
      DEFAULTS.PROVIDER_GOOGLE,
    );
  }

  /**
   * Internal: attempt a single completion call.
   */
  protected override async attemptGenerate(prompt: string, options?: IModelOptions): Promise<string> {
    const endpoint = `${this.baseUrl}/${this.model}:generateContent?key=${this.apiKey}`;

    const data = await performProviderCall<GoogleResponse>(endpoint, {
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
    return data;
  }
}
