/**
 * @module OpenRouterProviderFactory
 * @path packages/ai-openrouter/src/openrouter_factory.ts
 * @related-files ["packages/ai-openrouter/src/openrouter_provider.ts", "packages/ai-openrouter/src/constants.ts"]
 * @architectural-layer AI
 * @dependencies ["@exaix/ai", "@exaix/ai/types.ts", "@exaix/core"]
 * @description Factory for creating OpenRouter provider instances using API-key auth.
 * Honours the [ai_openrouter] config block (api_key_env, site_name, site_url).
 */

import { AbstractKeyBasedProviderFactory } from "@exaix/ai/factories/abstract_provider_factory.ts";
import { ProviderFactoryError } from "@exaix/ai/errors.ts";
import { getApiKeyWithOptionalPersistence } from "@exaix/ai/provider_api_key.ts";
import type { IModelProvider, IResolvedProviderOptions } from "@exaix/ai/types.ts";
import type { IProviderModelInfo } from "@exaix/ai";
import { SecureCredentialStore } from "@exaix/core";
import {
  DEFAULT_OPENROUTER_API_KEY_ENV,
  DEFAULT_OPENROUTER_ENDPOINT,
  DEFAULT_OPENROUTER_TIMEOUT_MS,
  OPENROUTER_MODEL_INFO_TIMEOUT_MS,
  PROVIDER_OPENROUTER,
} from "./constants.ts";
import {
  deriveOpenRouterModelsUrl,
  type IOpenRouterModelCapabilitiesOptions,
  OpenRouterModelCapabilities,
} from "./openrouter_model_capabilities.ts";
import { OpenRouterProvider } from "./openrouter_provider.ts";

export class OpenRouterProviderFactory extends AbstractKeyBasedProviderFactory {
  private readonly lookups = new Map<string, OpenRouterModelCapabilities>();
  private modelLookup: OpenRouterModelCapabilities | undefined;

  constructor() {
    super(DEFAULT_OPENROUTER_API_KEY_ENV);
  }

  /** Reads catalog metadata without persisting credentials or creating a provider. */
  async modelInfo(model: string): Promise<IProviderModelInfo | undefined> {
    if (!this.modelLookup) {
      const apiKey = Deno.env.get(DEFAULT_OPENROUTER_API_KEY_ENV) ||
        await SecureCredentialStore.get(DEFAULT_OPENROUTER_API_KEY_ENV);
      if (!apiKey) return undefined;
      this.modelLookup = this.lookupFor({
        apiKey,
        modelsUrl: deriveOpenRouterModelsUrl(DEFAULT_OPENROUTER_ENDPOINT),
        providerId: PROVIDER_OPENROUTER,
        timeoutMs: OPENROUTER_MODEL_INFO_TIMEOUT_MS,
      });
    }
    const entry = await this.modelLookup.getEntry(model);
    if (!entry) return undefined;
    return {
      ...(entry.contextLength !== undefined ? { contextWindow: entry.contextLength } : {}),
      ...entry.pricing,
      supportsThinking: entry.reasoning !== undefined || entry.supportedParameters.includes("reasoning"),
      supportsEffort: (entry.reasoning?.supportedEfforts.length ?? 0) > 0 ||
        entry.supportedParameters.includes("reasoning_effort"),
    };
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
    this.modelLookup = this.lookupFor({
      apiKey,
      modelsUrl: deriveOpenRouterModelsUrl(options.baseUrl || DEFAULT_OPENROUTER_ENDPOINT),
      providerId: id,
      timeoutMs: Math.min(options.timeoutMs || DEFAULT_OPENROUTER_TIMEOUT_MS, OPENROUTER_MODEL_INFO_TIMEOUT_MS),
      logger: options.logger,
    });
    return new OpenRouterProvider({
      apiKey,
      model: options.model,
      baseUrl: options.baseUrl,
      id,
      logger: options.logger,
      config: options.config,
      timeoutMs: options.timeoutMs,
      capabilities: this.modelLookup,
      siteName: openrouterConfig?.site_name,
      siteUrl: openrouterConfig?.site_url,
      routing: openrouterConfig?.routing,
      cacheControl: openrouterConfig?.cache_control,
    });
  }

  private lookupFor(options: IOpenRouterModelCapabilitiesOptions): OpenRouterModelCapabilities {
    let lookup = this.lookups.get(options.modelsUrl);
    if (!lookup) {
      lookup = new OpenRouterModelCapabilities(options);
      this.lookups.set(options.modelsUrl, lookup);
    }
    return lookup;
  }
}
