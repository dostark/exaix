/**
 * @module OpenAIProviderFactory
 * @path src/ai/factories/openai_factory.ts
 * @description Factory for creating OpenAI provider instances, supporting custom base URLs for compatible APIs.
 * @architectural-layer AI
 * * @related-files [src/ai/providers/openai_provider.ts]
 */
import { AbstractKeyBasedProviderFactory } from "./abstract_provider_factory.ts";
import { IModelProvider, IResolvedProviderOptions } from "../types.ts";
import { OpenAIProvider } from "../providers/openai_provider.ts";

export class OpenAIProviderFactory extends AbstractKeyBasedProviderFactory {
  constructor() {
    super("OPENAI_API_KEY");
  }

  async create(options: IResolvedProviderOptions): Promise<IModelProvider> {
    const apiKey = await this.getApiKey(options);

    return new OpenAIProvider({
      apiKey,
      model: options.model,
      baseUrl: options.baseUrl,
      id: this.generateId("openai", options.model, options.id),
      logger: options.logger,
    });
  }
}
