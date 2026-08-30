/**
 * @module AbstractProviderFactory
 * @path packages/ai/src/factories/abstract_provider_factory.ts
 * @description Base abstractions for provider factories, defining interfaces and common logic for API key retrieval and ID generation.
 * @architectural-layer AI
 * @related-files [packages/ai/src/provider_registry.ts, packages/ai-anthropic/src/anthropic_factory.ts]
 */
import type { IModelProvider, IResolvedProviderOptions } from "../types.ts";
import { getApiKeyWithOptionalPersistence } from "../provider_api_key.ts";
import { ProviderFactoryError } from "../errors.ts";
import type { Opt, Reason } from "@exaix/core/types";

export interface IProviderFactory {
  create(options: IResolvedProviderOptions): Promise<IModelProvider>;
}

/**
 * Abstract base class for provider factories.
 */
export abstract class AbstractProviderFactory implements IProviderFactory {
  abstract create(options: IResolvedProviderOptions): Promise<IModelProvider>;

  protected generateId(
    provider: string,
    model: string,
    id?: Opt<string, Reason.AbstractBoundary>,
  ): string {
    return id ?? `${provider}-${model}`;
  }
}

/** Abstract factory for providers that require an API key, retrieved from environment or secure storage. */
export abstract class AbstractKeyBasedProviderFactory extends AbstractProviderFactory {
  constructor(protected envKeyName: string) {
    super();
  }

  protected async getApiKey(options: IResolvedProviderOptions): Promise<string> {
    // If API key provided strictly in options, use it
    if (options.apiKey) {
      return options.apiKey;
    }

    // Otherwise try to get from environment/persistence
    const apiKey = await getApiKeyWithOptionalPersistence(this.envKeyName);

    if (!apiKey) {
      throw new ProviderFactoryError(
        `Authentication failed: ${this.envKeyName} not found in environment or credential store`,
      );
    }

    return apiKey;
  }
}
