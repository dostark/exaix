/**
 * @module LlamaPackageProvider
 * @path packages/ai-ollama/src/llama_provider.ts
 * @description Llama and CodeLlama provider implementation owned by the @exaix/ai-ollama package.
 * @architectural-layer AI
 * @related-files [packages/ai-ollama/src/llama_factory.ts, packages/ai-ollama/src/llama_provider.ts]
 */

import {
  DEFAULT_OLLAMA_ENDPOINT,
  DEFAULT_OLLAMA_RETRY_BACKOFF_MS,
  DEFAULT_OLLAMA_RETRY_MAX_ATTEMPTS,
  DEFAULT_OLLAMA_TIMEOUT_MS,
} from "./constants.ts";
import { calculateCost, fetchJsonWithRetries, type OllamaResponse } from "@exaix/ai/provider_common_utils.ts";
import type { IGenerateResult } from "@exaix/ai/providers";
import type { IModelOptions, IModelProvider } from "@exaix/ai/types.ts";

export interface ILlamaProviderRuntimeConfig {
  ai_endpoints?: {
    ollama?: string;
  };
  ai_retry?: {
    providers?: {
      ollama?: {
        max_attempts?: number;
        backoff_base_ms?: number;
      };
    };
  };
  ai_timeout?: {
    providers?: {
      ollama?: number;
    };
  };
}

export interface ILlamaProviderOptions {
  model: string;
  endpoint?: string;
  id?: string;
  config?: ILlamaProviderRuntimeConfig;
  maxAttempts?: number;
  backoffBaseMs?: number;
  timeoutMs?: number;
}

export class LlamaProvider implements IModelProvider {
  readonly id: string;
  readonly model: string;
  readonly endpoint: string;
  private readonly maxAttempts: number;
  private readonly backoffBaseMs: number;
  public readonly timeoutMs: number;

  constructor(options: ILlamaProviderOptions) {
    if (!/^codellama:|^llama[0-9.]*:/.test(options.model)) {
      throw new Error("Unsupported model");
    }

    this.model = options.model;
    this.endpoint = options.endpoint ||
      options.config?.ai_endpoints?.ollama ||
      DEFAULT_OLLAMA_ENDPOINT;
    this.id = options.id || `llama-${this.model}`;
    this.maxAttempts = options.maxAttempts ||
      options.config?.ai_retry?.providers?.ollama?.max_attempts ||
      DEFAULT_OLLAMA_RETRY_MAX_ATTEMPTS;
    this.backoffBaseMs = options.backoffBaseMs ||
      options.config?.ai_retry?.providers?.ollama?.backoff_base_ms ||
      DEFAULT_OLLAMA_RETRY_BACKOFF_MS;
    this.timeoutMs = options.timeoutMs ||
      options.config?.ai_timeout?.providers?.ollama ||
      DEFAULT_OLLAMA_TIMEOUT_MS;
  }

  async generate(prompt: string, _options?: IModelOptions): Promise<IGenerateResult> {
    const body = {
      model: this.model,
      prompt,
      stream: false,
    };

    const data = await fetchJsonWithRetries<OllamaResponse>(this.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }, {
      id: this.id,
      maxAttempts: this.maxAttempts,
      backoffBaseMs: this.backoffBaseMs,
      timeoutMs: this.timeoutMs,
    });

    if (!data || typeof data.response !== "string") {
      throw new Error("Invalid Ollama response");
    }

    let jsonText = data.response.trim();
    const jsonMatch = jsonText.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
    if (jsonMatch) {
      jsonText = jsonMatch[1];
    } else {
      const jsonStart = jsonText.indexOf("{");
      const jsonEnd = jsonText.lastIndexOf("}");
      if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
        jsonText = jsonText.slice(jsonStart, jsonEnd + 1);
      }
    }

    const generateResult = (content: string): IGenerateResult => {
      const promptTokens = data.prompt_eval_count ?? 0;
      const completionTokens = data.eval_count ?? 0;
      const totalTokens = promptTokens + completionTokens;
      return {
        content,
        usage: { promptTokens, completionTokens, totalTokens },
        model: this.model,
        provider: this.id,
        cost_usd: calculateCost(this.id, totalTokens),
      };
    };

    try {
      JSON.parse(jsonText);
      return generateResult(jsonText);
    } catch {
      return generateResult(data.response);
    }
  }
}
