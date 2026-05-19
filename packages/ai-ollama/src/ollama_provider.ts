/**
 * @module OllamaPackageProvider
 * @path packages/ai-ollama/src/ollama_provider.ts
 * @description Ollama inference provider implementation owned by the @exaix/ai-ollama package.
 * @architectural-layer AI
 * @related-files [packages/ai-ollama/src/ollama_factory.ts, packages/ai/src/providers/ollama_provider.ts]
 */

import {
  DEFAULT_OLLAMA_BASE_URL,
  DEFAULT_OLLAMA_MODEL,
  DEFAULT_OLLAMA_RETRY_BACKOFF_MS,
  DEFAULT_OLLAMA_RETRY_MAX_ATTEMPTS,
  DEFAULT_OLLAMA_TIMEOUT_MS,
} from "./constants.ts";
import { fetchJsonWithRetries, type OllamaResponse } from "@exaix/ai/provider_common_utils.ts";
import { ConnectionError, type IGenerateResult, ModelProviderError, TimeoutError } from "@exaix/ai/providers";
import type { IModelOptions, IModelProvider } from "@exaix/ai/types.ts";

export interface IOllamaProviderOptions {
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
  id?: string;
}

export class OllamaProvider implements IModelProvider {
  public readonly id: string;
  private readonly baseUrl: string;
  private readonly defaultModel: string;
  private readonly timeoutMs: number;

  constructor(options: IOllamaProviderOptions = {}) {
    this.baseUrl = options.baseUrl ?? DEFAULT_OLLAMA_BASE_URL;
    this.defaultModel = options.model ?? DEFAULT_OLLAMA_MODEL;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_OLLAMA_TIMEOUT_MS;
    this.id = options.id ?? `ollama-${this.defaultModel}`;
  }

  async generate(prompt: string, options?: IModelOptions): Promise<IGenerateResult> {
    try {
      const data = await fetchJsonWithRetries<OllamaResponse>(
        `${this.baseUrl}/api/generate`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: this.defaultModel,
            prompt,
            stream: false,
            options: {
              temperature: options?.temperature,
              num_predict: options?.max_tokens,
              top_p: options?.top_p,
              stop: options?.stop,
            },
          }),
        },
        {
          id: this.id,
          maxAttempts: DEFAULT_OLLAMA_RETRY_MAX_ATTEMPTS,
          backoffBaseMs: DEFAULT_OLLAMA_RETRY_BACKOFF_MS,
          timeoutMs: this.timeoutMs,
        },
      );

      if (!data.response) {
        throw new ModelProviderError("Invalid response from Ollama: missing 'response' field", this.id);
      }

      return {
        content: data.response,
        usage: {
          promptTokens: data.prompt_eval_count ?? 0,
          completionTokens: data.eval_count ?? 0,
          totalTokens: (data.prompt_eval_count ?? 0) + (data.eval_count ?? 0),
        },
        model: this.defaultModel,
        provider: "ollama",
        cost_usd: 0,
      };
    } catch (error) {
      if (error instanceof ModelProviderError) {
        throw error;
      }

      if (error instanceof Error && error.name === "AbortError") {
        throw new TimeoutError(this.id, this.timeoutMs);
      }

      if (error instanceof TypeError && error.message.includes("fetch")) {
        throw new ConnectionError(this.id, `Failed to connect to Ollama at ${this.baseUrl}. Is Ollama running?`);
      }

      throw new ModelProviderError(
        `Unexpected error: ${error instanceof Error ? error.message : String(error)}`,
        this.id,
      );
    }
  }
}
