/**
 * @module MockProviderFactory
 * @path src/ai/factories/mock_factory.ts
 * @description Factory for creating MockLLMProvider instances with configurable strategies and fixtures.
 * @architectural-layer AI
 * * @related-files [src/ai/providers/mock_llm_provider.ts]
 */
import { AbstractProviderFactory } from "./abstract_provider_factory.ts";
import { IModelProvider, IResolvedProviderOptions } from "../types.ts";
import { MockLLMProvider } from "../providers/mock_llm_provider.ts";
import * as DEFAULTS from "../../shared/constants.ts";

export class MockProviderFactory extends AbstractProviderFactory {
  async create(options: IResolvedProviderOptions): Promise<IModelProvider> {
    const strategy = options.mockStrategy ?? DEFAULTS.DEFAULT_MOCK_STRATEGY;

    return await new MockLLMProvider(strategy, {
      id: options.id ?? `mock-${strategy}-${options.model}`,
      fixtureDir: options.mockFixturesDir,
      responses: options.responses,
    });
  }
}
