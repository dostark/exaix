/**
 * @module OpenRouterProviderFactory
 * @path packages/ai-openrouter/src/openrouter_factory.ts
 * @related-files ["packages/ai-openrouter/src/openrouter_provider.ts", "packages/ai-openrouter/src/constants.ts"]
 * @architectural-layer AI
 * @dependencies ["@exaix/ai", "@exaix/ai/types.ts"]
 * @description Factory for creating OpenRouter provider instances using API-key auth.
 */

import { AbstractKeyBasedProviderFactory } from "@exaix/ai/factories/abstract_provider_factory.ts";
import type { IModelProvider, IResolvedProviderOptions } from "@exaix/ai/types.ts";
import { PROVIDER_OPENROUTER } from "./constants.ts";
import { OpenRouterProvider } from "./openrouter_provider.ts";

export class OpenRouterProviderFactory extends AbstractKeyBasedProviderFactory {
  constructor() {
    super("OPENROUTER_API_KEY");
  }

  async create(options: IResolvedProviderOptions): Promise<IModelProvider> {
    const apiKey = await this.getApiKey(options);

    return new OpenRouterProvider({
      apiKey,
      model: options.model,
      baseUrl: options.baseUrl,
      id: this.generateId(PROVIDER_OPENROUTER, options.model, options.id),
      logger: options.logger,
      timeoutMs: options.timeoutMs,
    });
  }
}
