/**
 * @module ModelProviders
 * @path src/ai/providers.ts
 * @description Unified adapter interface for interacting with various LLM providers, abstracting connection details and authentication.
 * @architectural-layer AI
 * @related-files [src/ai/provider_registry.ts, src/ai/factories/abstract_provider_factory.ts]
 */

import { ProviderRegistry } from "./provider_registry.ts";
import type { IModelOptions, IModelProvider, IResolvedProviderOptions } from "./types.ts";
import type { IGenerateResult } from "./providers/common.ts";
import {
  createOpenAIChatCompletionsRequestInit,
  extractOpenAIContent,
  fetchJsonWithRetries,
  type OpenAIResponse,
  tokenMapperOpenAI,
} from "./provider_common_utils.ts";

import { ensureProviderRegistryInitialized } from "./provider_factory.ts";
import { DEFAULT_AI_TIMEOUT_MS, DEFAULT_MOCK_MODEL, DEFAULT_MOCK_PROVIDER_ID, MOCK_DELAY_MS } from "@exaix/ai";

import { type MockStrategy, ProviderType } from "@exaix/core";
import {
  DEFAULT_OPENAI_MODEL,
  DEFAULT_OPENAI_RETRY_BACKOFF_MS,
  DEFAULT_OPENAI_RETRY_MAX_ATTEMPTS,
  DEFAULT_OPENAI_TIMEOUT_MS,
} from "@exaix/core";
import { ModelProviderError } from "./providers/common.ts";

/**
 * Provider configuration options
 */
export interface IProviderConfig {
  [key: string]: string | number | boolean | string[] | null | undefined;
}

const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com";

declare const Deno: { env: { get(key: string): string | undefined } };

// ============================================================================
// Mock Provider (for testing)
// ============================================================================

/**
 * Mock provider that returns a predictable, configurable response.
 * Used for unit testing and development.
 */
export class MockProvider implements IModelProvider {
  public readonly id: string;

  constructor(
    private readonly response: string,
    id: string = DEFAULT_MOCK_PROVIDER_ID,
  ) {
    this.id = id;
  }

  async generate(_prompt: string, _options?: IModelOptions): Promise<IGenerateResult> {
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

// ============================================================================
// Model Factory
// ============================================================================

/**
 * Safe environment accessor that returns undefined if env access is not permitted in test environments.
 */
function safeGetEnv(key: string): string | undefined {
  try {
    return Deno.env.get(key);
  } catch {
    return undefined;
  }
}

/**
 * Minimal OpenAI-compatible shim used by the factory to create quick model-specific adapters
 * without importing the full `OpenAIProvider` implementation (avoids circular imports).
 */

class OpenAIShim implements IModelProvider {
  public readonly id: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;

  constructor(options: { apiKey?: string; model?: string; baseUrl?: string; id?: string }) {
    this.apiKey = options.apiKey ?? "";
    this.model = options.model ?? DEFAULT_OPENAI_MODEL;
    this.baseUrl = options.baseUrl ?? DEFAULT_OPENAI_BASE_URL;
    this.id = options.id ?? `openai-${this.model}`;
  }

  async generate(prompt: string, options?: IModelOptions): Promise<IGenerateResult> {
    const url = `${this.baseUrl}/v1/chat/completions`;

    // Use default retry parameters
    const maxAttempts = DEFAULT_OPENAI_RETRY_MAX_ATTEMPTS;
    const backoffBaseMs = DEFAULT_OPENAI_RETRY_BACKOFF_MS;
    const timeoutMs = DEFAULT_OPENAI_TIMEOUT_MS;

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

/**
 * Factory for creating model provider instances based on configuration.
 */
export class ModelFactory {
  /**
   * Create a model provider instance.
   * @param providerType Type of provider ("mock", "ollama", etc.)
   * @param config Provider-specific configuration
   * @returns An instance implementing IModelProvider
   */
  static async create(
    providerType: string,
    config?: IProviderConfig,
  ): Promise<IModelProvider> {
    const normalizedType = providerType.toLowerCase().trim();

    // Initialize registry if needed
    if (ProviderRegistry.getSupportedProviders().length === 0) {
      ensureProviderRegistryInitialized();
    }

    // Check if this is a registered provider type
    if (ProviderRegistry.getSupportedProviders().includes(normalizedType)) {
      // Use registry-based factory creation
      const factory = ProviderRegistry.getFactory(normalizedType);
      if (factory) {
        const options: IResolvedProviderOptions = {
          provider: normalizedType as ProviderType,
          model: (config?.model as string) ?? "default-model",
          baseUrl: config?.baseUrl as string,
          timeoutMs: (config?.timeoutMs as number) ?? DEFAULT_AI_TIMEOUT_MS,
          apiKey: config?.apiKey as string,
          id: (config?.id as string) ?? (normalizedType === ProviderType.MOCK ? "mock-provider" : undefined),
          mockStrategy: (config?.mockStrategy ?? config?.strategy ?? (config?.response ? "scripted" : undefined)) as
            | MockStrategy
            | undefined,
          mockFixturesDir: config?.mockFixturesDir as string,
          // Support 'response' for backward compatibility with tests
          responses: config?.response ? [config.response as string] : undefined,
        };
        return await factory.create(options);
      }
    }

    // Handle convenience aliases for OpenAI-compatible models
    if (normalizedType.startsWith("gpt-")) {
      // In CI, prevent accidental calls to paid endpoints unless explicitly opted-in
      if (safeGetEnv("CI") && safeGetEnv("EXA_ENABLE_PAID_LLM") !== "1") {
        return new MockProvider("CI-protected mock", (config?.id as string) ?? "mock-provider");
      }

      return new OpenAIShim({
        apiKey: config?.apiKey as string ?? "",
        // Use the original providerType (preserve exact model id) when contacting the API
        model: providerType,
        baseUrl: config?.baseUrl as string | undefined,
        id: (config?.id as string) ?? `openai-${providerType}`,
      });
    }

    // If we reach here, the provider type is unknown
    throw new Error(
      `Unknown provider type: '${providerType}'. Supported types: ${
        ProviderRegistry.getSupportedProviders().join(", ")
      }`,
    );
  }
}
