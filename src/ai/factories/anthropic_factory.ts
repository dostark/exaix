/**
 * @module AnthropicProviderFactory
 * @path src/ai/factories/anthropic_factory.ts
 * @description Factory for creating Anthropic LLM provider instances, handling API key retrieval and configuration.
 * @architectural-layer AI
 * * @related-files [src/ai/providers/anthropic_provider.ts]
 */
import { AbstractKeyBasedProviderFactory } from "./abstract_provider_factory.ts";
import type { IModelProvider, IResolvedProviderOptions } from "../types.ts";
import { AnthropicProvider } from "../providers/anthropic_provider.ts";
import { PROVIDER_ANTHROPIC } from "../../shared/constants.ts";

export class AnthropicProviderFactory extends AbstractKeyBasedProviderFactory {
  constructor() {
    super("ANTHROPIC_API_KEY");
  }

  async create(options: IResolvedProviderOptions): Promise<IModelProvider> {
    const apiKey = await this.getApiKey(options);

    return new AnthropicProvider({
      apiKey,
      model: options.model,
      id: this.generateId(PROVIDER_ANTHROPIC, options.model, options.id),
      logger: options.logger,
    });
  }
}
