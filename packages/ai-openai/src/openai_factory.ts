/**
 * @module OpenAIPackageProviderFactory
 * @path packages/ai-openai/src/openai_factory.ts
 * @description Factory for creating OpenAI provider instances from the @exaix/ai-openai package.
 * @architectural-layer AI
 * @related-files [packages/ai-openai/src/openai_provider.ts, packages/ai/src/factories/openai_factory.ts]
 */

import { AbstractKeyBasedProviderFactory } from "@exaix/ai/factories/abstract_provider_factory.ts";
import type { IModelProvider, IResolvedProviderOptions } from "@exaix/ai/types.ts";
import { PROVIDER_OPENAI } from "./constants.ts";
import { OpenAIProvider } from "./openai_provider.ts";

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
      id: this.generateId(PROVIDER_OPENAI, options.model, options.id),
      logger: options.logger,
    });
  }
}
