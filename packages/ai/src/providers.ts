/**
 * @module ModelProviders
 * @path packages/ai/src/providers.ts
 * @description Unified adapter interface for interacting with various LLM providers, abstracting connection details and authentication.
 * @architectural-layer AI
 * @related-files [packages/ai/src/provider_registry.ts, packages/ai/src/factories/abstract_provider_factory.ts]
 */

import type { IModelOptions, IModelProvider } from "./types.ts";
import type { Opt, Reason } from "@exaix/core/types";
import type { IGenerateResult } from "./providers/common.ts";
import {
  createOpenAIChatCompletionsRequestInit,
  extractOpenAIContent,
  fetchJsonWithRetries,
  type OpenAIResponse,
  tokenMapperOpenAI,
} from "./provider_common_utils.ts";

import { DEFAULT_AI_TIMEOUT_MS, DEFAULT_MOCK_MODEL, DEFAULT_MOCK_PROVIDER_ID, MOCK_DELAY_MS } from "@exaix/ai";
import { ModelProviderError } from "./providers/common.ts";

/**
 * Provider configuration options
 */
export interface IProviderConfig {
  [key: string]: string | number | boolean | string[] | null | undefined;
}

const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com";

// Mirror @exaix/ai-openai constants — cannot import from there due to circular dependency.
const _OPENAI_MODEL = "gpt-5-mini";
const _OPENAI_RETRY_BACKOFF_MS = 1000;
const _OPENAI_RETRY_MAX_ATTEMPTS = 3;
const _OPENAI_TIMEOUT_MS = DEFAULT_AI_TIMEOUT_MS;

declare const Deno: { env: { get(key: string): string | undefined } };

// Mock Provider (for testing)

export class MockProvider implements IModelProvider {
  public readonly id: string;

  constructor(
    private readonly response: string,
    id: string = DEFAULT_MOCK_PROVIDER_ID,
  ) {
    this.id = id;
  }

  async generate(_prompt: string, _options?: Opt<IModelOptions, Reason.AbstractBoundary>): Promise<IGenerateResult> {
    // Simulate async behavior
    await new Promise((resolve) => setTimeout(resolve, MOCK_DELAY_MS));
    return {
      content: this.response,
      usage: {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
      },
      model: DEFAULT_MOCK_MODEL,
      provider: DEFAULT_MOCK_PROVIDER_ID,
      cost_usd: 0,
    };
  }
}

// Model Factory

/** Minimal OpenAI-compatible shim for quick model-specific adapters — avoids importing
 * the full `OpenAIProvider` implementation (would create a circular import). */

export class OpenAIShim implements IModelProvider {
  public readonly id: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;

  constructor(options: { apiKey?: string; model?: string; baseUrl?: string; id?: string }) {
    this.apiKey = options.apiKey ?? "";
    this.model = options.model ?? _OPENAI_MODEL;
    this.baseUrl = options.baseUrl ?? DEFAULT_OPENAI_BASE_URL;
    this.id = options.id ?? `openai-${this.model}`;
  }

  async generate(prompt: string, options?: Opt<IModelOptions, Reason.OptionalInput>): Promise<IGenerateResult> {
    const url = `${this.baseUrl}/v1/chat/completions`;

    // Use default retry parameters
    const maxAttempts = _OPENAI_RETRY_MAX_ATTEMPTS;
    const backoffBaseMs = _OPENAI_RETRY_BACKOFF_MS;
    const timeoutMs = _OPENAI_TIMEOUT_MS;

    const data = await fetchJsonWithRetries<OpenAIResponse>(
      url,
      createOpenAIChatCompletionsRequestInit(this.apiKey, this.model, prompt, options),
      {
        id: this.id,
        maxAttempts,
        backoffBaseMs,
        timeoutMs,
        tokenMapper: tokenMapperOpenAI(this.model),
      },
    );

    const content = extractOpenAIContent(data);
    if (!content) {
      throw new ModelProviderError("Invalid response from OpenAI-compatible endpoint", this.id);
    }

    return {
      content,
      usage: {
        promptTokens: data.usage?.prompt_tokens ?? 0,
        completionTokens: data.usage?.completion_tokens ?? 0,
        totalTokens: data.usage?.total_tokens ?? 0,
      },
      model: this.model,
      provider: "openai-shim",
      cost_usd: 0,
    };
  }
}
