/**
 * @module LlamaProvider
 * @path src/ai/providers/llama_provider.ts
 * @description IModelProvider implementation for Llama and CodeLlama models, typically served via Ollama.
 * @architectural-layer AI
 * @related-files [src/ai/factories/llama_factory.ts, src/ai/factories/ollama_factory.ts]
 */
import type { IModelOptions, IModelProvider } from "../types.ts";
import type { Config } from "@exaix/schemas/config.ts";
import * as DEFAULTS from "@exaix/ai";
import { calculateCost, fetchJsonWithRetries, type OllamaResponse } from "../provider_common_utils.ts";
import type { IGenerateResult } from "./common.ts";

/**
 * Options for LlamaProvider.
 */
export interface ILlamaProviderOptions {
  model: string;
  endpoint?: string;
  id?: string;
  config?: Config;
  maxAttempts?: number;
  backoffBaseMs?: number;
  timeoutMs?: number;
}

/**
 * LlamaProvider implements IModelProvider for Llama and CodeLlama models (Ollama API).
 */
export class LlamaProvider implements IModelProvider {
  readonly id: string;
  readonly model: string;
  readonly endpoint: string;
  private readonly maxAttempts: number;
  private readonly backoffBaseMs: number;
  public readonly timeoutMs: number;

  /**
   * @param options.model Model name (must start with codellama: or llamaX:)
   * @param options.endpoint Ollama API endpoint (reads from config or defaults)
   * @param options.id Optional provider id
   * @param options.config Optional config for endpoint and retry settings
   */
  constructor(options: ILlamaProviderOptions) {
    if (!/^codellama:|^llama[0-9.]*:/.test(options.model)) {
      throw new Error("Unsupported model");
    }
    this.model = options.model;

    // Read endpoint from config or use default
    this.endpoint = options.endpoint ||
      options.config?.ai_endpoints?.ollama ||
      DEFAULTS.DEFAULT_OLLAMA_ENDPOINT;

    this.id = options.id || `llama-${this.model}`;

    // Read retry settings from config or use defaults
    this.maxAttempts = options.maxAttempts ||
      options.config?.ai_retry?.providers?.ollama?.max_attempts ||
      DEFAULTS.DEFAULT_OLLAMA_RETRY_MAX_ATTEMPTS;

    this.backoffBaseMs = options.backoffBaseMs ||
      options.config?.ai_retry?.providers?.ollama?.backoff_base_ms ||
      DEFAULTS.DEFAULT_OLLAMA_RETRY_BACKOFF_MS;

    // Read timeout from options, config, or default
    this.timeoutMs = options.timeoutMs ||
      options.config?.ai_timeout?.providers?.ollama ||
      DEFAULTS.DEFAULT_OLLAMA_TIMEOUT_MS;
  }

  /**
   * Generate a completion from the model.
   */
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

    // Extract JSON from response, handling markdown formatting
    let jsonText = data.response.trim();

    // Remove markdown code blocks if present
    const jsonMatch = jsonText.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
    if (jsonMatch) {
      jsonText = jsonMatch[1];
    } else {
      // Try to find JSON object directly
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

    // Try to parse as JSON
    try {
      JSON.parse(jsonText);
      return generateResult(jsonText);
    } catch (_parseError) {
      // If not valid JSON, return the raw response and let caller handle it
      return generateResult(data.response);
    }
  }
}
