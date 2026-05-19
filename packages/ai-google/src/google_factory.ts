/**
 * @module GooglePackageProviderFactory
 * @path packages/ai-google/src/google_factory.ts
 * @description Factory for creating Google provider instances from the @exaix/ai-google package.
 * @architectural-layer AI
 * @related-files [packages/ai-google/src/google_provider.ts, packages/ai/src/factories/google_factory.ts]
 */

import { AbstractKeyBasedProviderFactory } from "@exaix/ai/factories/abstract_provider_factory.ts";
import type { IModelProvider, IResolvedProviderOptions } from "@exaix/ai/types.ts";
import { PROVIDER_GOOGLE } from "./constants.ts";
import { GoogleProvider } from "./google_provider.ts";

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
