/**
 * @module OpenRouterProviderFactory
 * @path packages/ai-openrouter/src/openrouter_factory.ts
 * @related-files ["packages/ai-openrouter/src/openrouter_provider.ts", "packages/ai-openrouter/src/constants.ts"]
 * @architectural-layer AI
 * @dependencies ["@exaix/ai", "@exaix/ai/types.ts"]
 * @description Factory for creating OpenRouter provider instances using API-key auth.
 * Honours the [ai_openrouter] config block (api_key_env, site_name, site_url).
 */

import { AbstractKeyBasedProviderFactory } from "@exaix/ai/factories/abstract_provider_factory.ts";
import { ProviderFactoryError } from "@exaix/ai/errors.ts";
import { getApiKeyWithOptionalPersistence } from "@exaix/ai/provider_api_key.ts";
import type { IModelProvider, IResolvedProviderOptions } from "@exaix/ai/types.ts";
import {
  DEFAULT_OPENROUTER_API_KEY_ENV,
  DEFAULT_OPENROUTER_ENDPOINT,
  DEFAULT_OPENROUTER_TIMEOUT_MS,
  PROVIDER_OPENROUTER,
} from "./constants.ts";
import { deriveOpenRouterModelsUrl, OpenRouterModelCapabilities } from "./openrouter_model_capabilities.ts";
import { OpenRouterProvider } from "./openrouter_provider.ts";

export class OpenRouterProviderFactory extends AbstractKeyBasedProviderFactory {
  constructor() {
    super(DEFAULT_OPENROUTER_API_KEY_ENV);
  }

  async create(options: IResolvedProviderOptions): Promise<IModelProvider> {
    const openrouterConfig = options.config?.ai_openrouter;
    const apiKeyEnv = openrouterConfig?.api_key_env ?? DEFAULT_OPENROUTER_API_KEY_ENV;
    const apiKey = options.apiKey ?? await getApiKeyWithOptionalPersistence(apiKeyEnv);
    if (!apiKey) {
      throw new ProviderFactoryError(
        `Authentication failed: ${apiKeyEnv} not found in environment or credential store`,
      );
    }

    const id = this.generateId(PROVIDER_OPENROUTER, options.model, options.id);
    return new OpenRouterProvider({
      apiKey,
      model: options.model,
      baseUrl: options.baseUrl,
      id,
      logger: options.logger,
      timeoutMs: options.timeoutMs,
      capabilities: new OpenRouterModelCapabilities({
        apiKey,
        modelsUrl: deriveOpenRouterModelsUrl(options.baseUrl || DEFAULT_OPENROUTER_ENDPOINT),
        providerId: id,
        timeoutMs: options.timeoutMs || DEFAULT_OPENROUTER_TIMEOUT_MS,
        logger: options.logger,
      }),
      siteName: openrouterConfig?.site_name,
      siteUrl: openrouterConfig?.site_url,
      routing: openrouterConfig?.routing,
      cacheControl: openrouterConfig?.cache_control,
    });
  }
}
