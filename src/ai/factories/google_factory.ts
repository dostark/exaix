/**
 * @module GoogleProviderFactory
 * @path src/ai/factories/google_factory.ts
 * @description Factory for creating Google Gemini provider instances, managing authentication via Google API keys.
 * @architectural-layer AI
 * * @related-files [src/ai/providers/google_provider.ts]
 */
import { AbstractKeyBasedProviderFactory } from "./abstract_provider_factory.ts";
import type { IModelProvider, IResolvedProviderOptions } from "../types.ts";
import { GoogleProvider } from "../providers/google_provider.ts";
import { PROVIDER_GOOGLE } from "../../shared/constants.ts";

export class GoogleProviderFactory extends AbstractKeyBasedProviderFactory {
  constructor() {
    super("GOOGLE_API_KEY");
  }

  async create(options: IResolvedProviderOptions): Promise<IModelProvider> {
    const apiKey = await this.getApiKey(options);

    return new GoogleProvider({
      apiKey,
      model: options.model,
      id: this.generateId(PROVIDER_GOOGLE, options.model, options.id),
      logger: options.logger,
    });
  }
}
