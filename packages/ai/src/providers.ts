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

import { DEFAULT_MOCK_MODEL, DEFAULT_MOCK_PROVIDER_ID, MOCK_DELAY_MS } from "@exaix/ai";

/**
 * Provider configuration options
 */
export interface IProviderConfig {
  [key: string]: string | number | boolean | string[] | null | undefined;
}

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
