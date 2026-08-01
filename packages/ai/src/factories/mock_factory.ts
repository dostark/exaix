/**
 * @module MockProviderFactory
 * @path packages/ai/src/factories/mock_factory.ts
 * @description Factory for creating MockLLMProvider instances with configurable strategies and fixtures.
 * @architectural-layer AI
 * @related-files [packages/ai/src/providers/mock_llm_provider.ts]
 */
import { AbstractProviderFactory } from "./abstract_provider_factory.ts";
import type { IModelProvider, IResolvedProviderOptions } from "../types.ts";
import { MockLLMProvider } from "../providers/mock_llm_provider.ts";
import * as DEFAULTS from "@exaix/ai";

export class MockProviderFactory extends AbstractProviderFactory {
  async create(options: IResolvedProviderOptions): Promise<IModelProvider> {
    const strategy = options.mockStrategy ?? DEFAULTS.DEFAULT_MOCK_STRATEGY;

    const provider = await new MockLLMProvider(strategy, {
      id: options.id ?? `mock-${strategy}-${options.model}`,
      fixtureDir: options.mockFixturesDir,
      responses: options.responses,
      strictRecordings: options.mockStrict,
    });

    // `recorded` is the default strategy and the provider silently substitutes default
    // patterns when no fixtures are configured, so an id of `mock-recorded-<model>` claimed a
    // replay that never happened — every scenario journal so far says "recorded" while the
    // responses came from regexes. Name what actually ran.
    if (!options.id && provider.isPatternFallback) {
      return Object.assign(provider, { id: `mock-pattern-${options.model}` });
    }

    return provider;
  }
}
