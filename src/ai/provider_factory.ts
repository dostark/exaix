/**
 * @module ProviderFactory
 * @path src/ai/provider_factory.ts
 * @description Factory pattern implementation for instantiating LLM providers.
 * Handles configuration resolution, fallback chains, and provider initialization.
 * @architectural-layer AI Layer
 * * @related-files [src/ai/provider_registry.ts, src/ai/providers.ts]
 */

import * as DEFAULTS from "../shared/constants.ts";
import type { Config } from "../shared/schemas/config.ts";
import { type AiConfig, getDefaultModels } from "../shared/schemas/ai_config.ts";
import { LlamaProvider } from "./providers/llama_provider.ts";
import { InputValidator } from "../shared/schemas/input_validation.ts";
import { CostTracker } from "../services/cost/cost_tracker.ts";
import type { DatabaseService } from "../services/core/db.ts";
import { createAPIRetryPolicy, RetryPolicy } from "../services/core/retry_policy.ts";
import { type IProviderMetadata, ProviderRegistry } from "./provider_registry.ts";
import { AnthropicProviderFactory } from "./factories/anthropic_factory.ts";
import { GoogleProviderFactory } from "./factories/google_factory.ts";
import { MockProviderFactory } from "./factories/mock_factory.ts";
import { OllamaProviderFactory } from "./factories/ollama_factory.ts";
import { OpenAIProviderFactory } from "./factories/openai_factory.ts";
import { AbstractKeyBasedProviderFactory } from "./factories/abstract_provider_factory.ts";
import { RateLimitedProvider } from "./rate_limited_provider.ts";
import { ConfigSource, type MockStrategy, PricingTier, ProviderType } from "../shared/enums.ts";
import type { IModelProvider, IProviderInfo, IResolvedProviderOptions } from "./types.ts";
import { ProviderFactoryError } from "./errors.ts";
import type { EventLogger } from "../services/core/event_logger.ts";

import { LazyProvider } from "./providers/lazy_provider.ts";

declare const Deno: { env: { get(key: string): string | undefined } };

// ============================================================================
// ProviderFactory Implementation
// ============================================================================

/**
 * Factory for creating LLM providers based on environment and configuration.
 * Provides static methods for provider instantiation and info.
 */
export class ProviderFactory {
  /**
   * Create an LLM provider using a fallback chain.
   * Tries primary, then fallbacks, with optional health check and retry logic.
   *
   * @param config - Exaix configuration
   * @param fallback - Fallback chain config
   * @param db - Optional database service for cost tracking
   * @returns An IModelProvider instance
   */
  static async createWithFallback(
    config: Config,
    fallback: {
      primary: string;
      fallbacks: string[];
      maxRetries?: number;
      healthCheck?: boolean;
    },
    db?: DatabaseService,
    logger?: EventLogger,
    costTracker?: CostTracker,
  ): Promise<IModelProvider> {
    const chain = [fallback.primary, ...fallback.fallbacks];
    let lastError: Error | undefined;

    for (const providerName of chain) {
      try {
        // Create retry policy for this provider attempt
        const retryPolicy = fallback.maxRetries !== undefined
          ? new RetryPolicy({ maxRetries: fallback.maxRetries })
          : createAPIRetryPolicy();

        // Use retry policy to create the provider
        const retryResult = await retryPolicy.execute(async () => {
          return await this.createByName(config, providerName, db, logger, costTracker);
        });

        if (!retryResult.success) {
          throw retryResult.error || new Error("Provider creation failed after retries");
        }

        const provider = retryResult.value!; // We know it's defined since success is true

        // Optional health check before returning
        if (fallback.healthCheck) {
          await validateProviderConnection(provider);
        }

        return provider;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        // Use repo logging convention if available
        if (typeof console !== "undefined" && typeof console.warn === "function") {
          console.warn(`Provider ${providerName} failed after retries, trying next in chain`, error);
        }
        continue;
      }
    }

    throw new ProviderFactoryError(
      "All providers in fallback chain failed" + (lastError ? ": " + String(lastError) : ""),
    );
  }

  /**
   * Create an LLM provider by looking up a named fallback chain in configuration.
   *
   * @param config - Exaix configuration
   * @param chainName - Name of the fallback chain to use (e.g., "balanced", "fast")
   * @param db - Optional database service for cost tracking
   * @returns An IModelProvider instance
   */
  static async createByChainName(
    config: Config,
    chainName: string,
    db?: DatabaseService,
    logger?: EventLogger,
    costTracker?: CostTracker,
  ): Promise<IModelProvider> {
    const chain = config.provider_strategy?.fallback_chains?.[chainName];

    if (!chain || chain.length === 0) {
      throw new ProviderFactoryError(`Fallback chain '${chainName}' not found in configuration`);
    }

    const primary = chain[0];
    const fallbacks = chain.slice(1);

    // AI retry config for fallback attempts
    const maxRetries = config.ai_retry?.max_attempts;

    return await this.createWithFallback(
      config,
      {
        primary,
        fallbacks,
        maxRetries,
        healthCheck: config.provider_strategy?.health_check_enabled,
      },
      db,
      logger,
      costTracker,
    );
  }
  /**
   * Create an LLM provider based on environment and configuration.
   *
   * Priority order:
   * 1. Environment variables (EXA_LLM_PROVIDER, EXA_LLM_MODEL, etc.)
   * 2. Config file [ai] section
   * 3. Defaults (MockLLMProvider)
   *
   * @param config - Exaix configuration
   * @param db - Optional database service for cost tracking
   * @returns An IModelProvider instance
   */
  static async create(
    config: Config,
    db?: DatabaseService,
    logger?: EventLogger,
    costTracker?: CostTracker,
  ): Promise<IModelProvider> {
    const options = this.resolveOptions(config);
    options.logger = logger;
    return await this.createAndWrap(config, options, db, costTracker);
  }

  /**
   * Create an LLM provider by name from the models configuration.
   *
   * @param config - Exaix configuration
   * @param name - Name of the model configuration (e.g., "default", "fast")
   * @param db - Optional database service for cost tracking
   * @returns An IModelProvider instance
   */
  static async createByName(
    config: Config,
    name: string,
    db?: DatabaseService,
    logger?: EventLogger,
    costTracker?: CostTracker,
  ): Promise<IModelProvider> {
    // Check if name refers to a fallback chain
    if (config.provider_strategy?.fallback_enabled && config.provider_strategy?.fallback_chains?.[name]) {
      return await this.createByChainName(config, name, db, logger, costTracker);
    }

    const options = this.resolveOptionsByName(config, name);
    options.logger = logger;
    return await this.createAndWrap(config, options, db, costTracker);
  }

  /**
   * Get information about what provider would be created
   *
   * @param config - Exaix configuration
   * @returns Provider information for logging
   */
  static getProviderInfo(config: Config): IProviderInfo {
    const options = this.resolveOptions(config);
    return this.buildProviderInfo(options);
  }

  /**
   * Get information about what provider would be created by name
   *
   * @param config - Exaix configuration
   * @param name - Name of the model configuration
   * @returns Provider information for logging
   */
  static getProviderInfoByName(config: Config, name: string): IProviderInfo {
    const options = this.resolveOptionsByName(config, name);
    return this.buildProviderInfo(options);
  }

  /**
   * Resolve provider options from environment and config.
   * Accepts a model-level config (may have optional fields) and merges
   * env vars, modelConfig, and global config to produce a fully populated
   * ResolvedProviderOptions (guarantees timeoutMs).
   */
  private static resolveOptions(
    config: Config,
    rawModelConfig?: unknown,
  ): IResolvedProviderOptions {
    // ✓ Validate model config to prevent type confusion attacks
    const modelConfig = rawModelConfig ? InputValidator.validateModelConfig(rawModelConfig) : undefined;
    const envProvider = this.safeEnvGet("EXA_LLM_PROVIDER");
    const envModel = this.safeEnvGet("EXA_LLM_MODEL");
    const envBaseUrl = this.safeEnvGet("EXA_LLM_BASE_URL");
    const envTimeout = this.safeEnvGet("EXA_LLM_TIMEOUT_MS");

    // Base ai config from global config or sensible defaults
    const baseAi: AiConfig = (config.ai as AiConfig) ?? {
      provider: ProviderType.MOCK,
      timeout_ms: DEFAULTS.DEFAULT_AI_TIMEOUT_MS,
    };

    // Merge model-level config (may be from config.models[name]) on top of baseAi
    const merged: Partial<AiConfig> = {
      ...baseAi,
      ...(modelConfig ?? {}),
    };

    // Resolve provider type (env > modelConfig > global)
    let providerType: ProviderType = ProviderType.MOCK;
    if (envProvider) {
      const normalized = envProvider.toLowerCase().trim();
      // Initialize registry if needed
      if (ProviderRegistry.getSupportedProviders().length === 0) {
        initializeRegistry();
      }
      if (ProviderRegistry.getSupportedProviders().includes(normalized)) {
        providerType = normalized as ProviderType;
      } else {
        console.warn(`Unknown provider '${envProvider}' from EXA_LLM_PROVIDER, falling back to mock`);
        providerType = ProviderType.MOCK;
      }
    } else if (merged.provider) {
      // Initialize registry if needed for validation
      if (ProviderRegistry.getSupportedProviders().length === 0) {
        initializeRegistry();
      }
      if (ProviderRegistry.getSupportedProviders().includes(merged.provider)) {
        providerType = merged.provider as ProviderType;
      } else {
        console.warn(`Unknown provider '${merged.provider}' from config, falling back to mock`);
        providerType = ProviderType.MOCK;
      }
    }

    // Resolve model (env > merged.model > default per provider)
    const model = envModel ?? (merged.model ?? getDefaultModels()[providerType]);

    // Resolve base url and timeout (env > merged > defaults)
    const baseUrl = envBaseUrl ?? merged.base_url;

    // Resolve timeout with provider-specific fallback from ai_timeout config
    let timeoutMs = DEFAULTS.DEFAULT_AI_TIMEOUT_MS;
    if (envTimeout) {
      timeoutMs = parseInt(envTimeout, 10);
    } else if (merged.timeout_ms) {
      timeoutMs = merged.timeout_ms;
    } else if (config.ai_timeout && providerType !== ProviderType.MOCK) {
      const providerTimeout = config.ai_timeout.providers?.[providerType];
      if (providerTimeout) {
        timeoutMs = providerTimeout;
      }
    }

    // Mock-specific
    const mockStrategy = merged.mock?.strategy ?? baseAi?.mock?.strategy ?? DEFAULTS.DEFAULT_MOCK_STRATEGY;
    const mockFixturesDir = merged.mock?.fixtures_dir ?? baseAi?.mock?.fixtures_dir;

    return {
      provider: providerType,
      model,
      baseUrl,
      timeoutMs,
      mockStrategy: mockStrategy as MockStrategy,
      mockFixturesDir,
    };
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Resolve provider options by name
   */
  private static resolveOptionsByName(config: Config, name: string): IResolvedProviderOptions {
    const modelConfig = config.models?.[name] ?? config.models?.["default"] ?? config.ai;
    return this.resolveOptions(config, modelConfig);
  }

  /**
   * Helper to create a provider and wrap it with rate limiting if configured
   */
  private static async createAndWrap(
    config: Config,
    options: IResolvedProviderOptions,
    db?: DatabaseService,
    costTracker?: CostTracker,
  ): Promise<IModelProvider> {
    const provider = await this.createProvider(options);

    // Apply rate limiting if enabled
    if (config.rate_limiting?.enabled) {
      const tracker = costTracker ?? (db ? new CostTracker(db, config) : undefined);
      return new RateLimitedProvider(provider, {
        maxCallsPerMinute: config.rate_limiting.max_calls_per_minute,
        maxTokensPerHour: config.rate_limiting.max_tokens_per_hour,
        maxCostPerDay: config.rate_limiting.max_cost_per_day,
        costPer1kTokens: config.rate_limiting.cost_per_1k_tokens,
        costTracker: tracker,
      });
    }

    return provider;
  }

  /**
   * Internal helper to build ProviderInfo from options
   */
  private static buildProviderInfo(options: IResolvedProviderOptions): IProviderInfo {
    const source = this.determineSource();
    return {
      type: options.provider,
      id: this.generateProviderId(options),
      model: options.model,
      source,
    };
  }

  /**
   * Determine the source of configuration
   */
  private static determineSource(): ConfigSource {
    if (this.safeEnvGet("EXA_LLM_PROVIDER")) {
      return ConfigSource.ENV;
    }
    // Note: We can't easily tell if config was set, so default to "config" if not env
    return ConfigSource.CONFIG;
  }

  /**
   * Create the appropriate provider based on resolved options
   */
  private static async createProvider(options: IResolvedProviderOptions): Promise<IModelProvider> {
    // Ensure registry is initialized
    initializeRegistry();

    // Try registry first for modern providers
    const factory = ProviderRegistry.getFactory(options.provider);
    if (factory) {
      // For key-based factories (which validate API keys on creation), we
      // must eagerly instantiate so that missing credentials cause create()
      // to reject as tests and calling code expect. Other factories can be
      // returned lazily to defer heavy initialization.
      if (factory instanceof AbstractKeyBasedProviderFactory) {
        return await factory.create(options);
      }

      // Use LazyProvider to defer initialization until first use
      // Provide a stable id (including mock strategy) so LazyProvider.id
      // matches what concrete factories will produce once initialized.
      const id = this.generateProviderId(options);
      return new LazyProvider(factory, options, id);
    }

    // Fall back to legacy direct instantiation for backward compatibility
    return await this.createProviderLegacy(options);
  }

  /**
   * Legacy provider creation for backward compatibility
   * TODO: Deprecate this method once all providers are migrated to registry
   */
  private static async createProviderLegacy(options: IResolvedProviderOptions): Promise<IModelProvider> {
    // Llama/Ollama model routing (special case for llama models)
    if (DEFAULTS.MODEL_ROUTING_LLAMA_PATTERN.test(options.model)) {
      return await new LlamaProvider({ model: options.model, endpoint: options.baseUrl });
    }

    // For any other provider, this fallback should not be reached since all providers
    // are now registered in the registry. If we reach here, it's an error.
    throw new ProviderFactoryError(
      `Provider '${options.provider}' is not registered in the provider registry. ` +
        `Available providers: ${ProviderRegistry.getSupportedProviders().join(", ")}`,
    );
  }

  /**
   * Generate a unique provider ID
   */
  private static generateProviderId(options: IResolvedProviderOptions): string {
    // Special case for mock provider which includes strategy
    if (options.provider === DEFAULTS.PROVIDER_MOCK) {
      return `${DEFAULTS.PROVIDER_ID_MOCK_PREFIX}${
        options.mockStrategy ?? DEFAULTS.PROVIDER_ID_MOCK_DEFAULT_STRATEGY
      }-${options.model}`;
    }

    // Default pattern for all other providers
    return `${options.provider}-${options.model}`;
  }

  /**
   * Safe environment getter that returns undefined when env access is not permitted
   */
  private static safeEnvGet(key: string): string | undefined {
    try {
      return Deno.env.get(key);
    } catch (_err) {
      // Deno will throw NotCapable when env access is not allowed in the runtime.
      // Swallow that and return undefined so callers can fall back to defaults.
      return undefined;
    }
  }
}

// ============================================================================
// Registry Initialization
// ============================================================================

/**
 * Initialize default provider factories in registry with metadata (lazy initialization)
 */
export function initializeRegistry(): void {
  // Only initialize if not already done
  if (ProviderRegistry.getSupportedProviders().length === 0) {
    // Mock provider - for testing and development
    const mockMetadata: IProviderMetadata = {
      name: DEFAULTS.PROVIDER_MOCK,
      description: DEFAULTS.PROVIDER_MOCK_DESCRIPTION,
      capabilities: DEFAULTS.PROVIDER_MOCK_CAPABILITIES,
      costTier: DEFAULTS.PROVIDER_COST_TIER_FREE,
      pricingTier: PricingTier.FREE,
      strengths: DEFAULTS.PROVIDER_MOCK_STRENGTHS,
    };
    ProviderRegistry.registerWithMetadata(DEFAULTS.PROVIDER_MOCK, new MockProviderFactory(), mockMetadata);

    // Ollama provider - local open-source models
    const ollamaMetadata: IProviderMetadata = {
      name: DEFAULTS.PROVIDER_OLLAMA,
      description: DEFAULTS.PROVIDER_OLLAMA_DESCRIPTION,
      capabilities: DEFAULTS.PROVIDER_OLLAMA_CAPABILITIES,
      costTier: DEFAULTS.PROVIDER_COST_TIER_FREE,
      pricingTier: PricingTier.LOCAL,
      strengths: DEFAULTS.PROVIDER_OLLAMA_STRENGTHS,
    };
    ProviderRegistry.registerWithMetadata(DEFAULTS.PROVIDER_OLLAMA, new OllamaProviderFactory(), ollamaMetadata);

    // Anthropic provider - Claude models
    const anthropicMetadata: IProviderMetadata = {
      name: DEFAULTS.PROVIDER_ANTHROPIC,
      description: DEFAULTS.PROVIDER_ANTHROPIC_DESCRIPTION,
      capabilities: DEFAULTS.PROVIDER_ANTHROPIC_CAPABILITIES,
      costTier: DEFAULTS.PROVIDER_COST_TIER_PAID,
      pricingTier: PricingTier.HIGH,
      strengths: DEFAULTS.PROVIDER_ANTHROPIC_STRENGTHS,
    };
    ProviderRegistry.registerWithMetadata(
      DEFAULTS.PROVIDER_ANTHROPIC,
      new AnthropicProviderFactory(),
      anthropicMetadata,
    );

    // OpenAI provider - GPT models
    const openaiMetadata: IProviderMetadata = {
      name: DEFAULTS.PROVIDER_OPENAI,
      description: DEFAULTS.PROVIDER_OPENAI_DESCRIPTION,
      capabilities: DEFAULTS.PROVIDER_OPENAI_CAPABILITIES,
      costTier: DEFAULTS.PROVIDER_COST_TIER_PAID,
      pricingTier: PricingTier.MEDIUM,
      strengths: DEFAULTS.PROVIDER_OPENAI_STRENGTHS,
    };
    ProviderRegistry.registerWithMetadata(
      DEFAULTS.PROVIDER_OPENAI,
      new OpenAIProviderFactory(),
      openaiMetadata,
    );

    // Google provider - Gemini models
    const googleMetadata: IProviderMetadata = {
      name: DEFAULTS.PROVIDER_GOOGLE,
      description: DEFAULTS.PROVIDER_GOOGLE_DESCRIPTION,
      capabilities: DEFAULTS.PROVIDER_GOOGLE_CAPABILITIES,
      costTier: DEFAULTS.PROVIDER_COST_TIER_FREEMIUM,
      pricingTier: PricingTier.LOW,
      strengths: DEFAULTS.PROVIDER_GOOGLE_STRENGTHS,
    };
    ProviderRegistry.registerWithMetadata(
      DEFAULTS.PROVIDER_GOOGLE,
      new GoogleProviderFactory(),
      googleMetadata,
    );
  }
}

// ============================================================================
// Provider Validation and Health Checks
// ============================================================================

/**
 * Validate that a provider connection is working by making a lightweight test request.
 * This is used for health checks in fallback chains.
 *
 * @param provider - The provider to validate
 * @returns Promise that resolves if connection is healthy, rejects if not
 */
export async function validateProviderConnection(provider: IModelProvider): Promise<void> {
  try {
    // Use a minimal test prompt that should work with any provider
    const testPrompt = DEFAULTS.PROVIDER_HEALTH_CHECK_TEST_PROMPT;
    const testOptions = {
      max_tokens: DEFAULTS.PROVIDER_HEALTH_CHECK_MAX_TOKENS,
      temperature: DEFAULTS.PROVIDER_HEALTH_CHECK_TEMPERATURE,
    };

    // Create a timeout promise with proper cleanup
    let timeoutId: number | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(
        () => reject(new Error("Health check timeout")),
        DEFAULTS.PROVIDER_HEALTH_CHECK_TIMEOUT_MS,
      );
    });

    try {
      // Race the health check against the timeout
      await Promise.race([
        provider.generate(testPrompt, testOptions),
        timeoutPromise,
      ]);
    } finally {
      // Always clear the timeout to prevent leaks
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }
    }
  } catch (error) {
    throw new ProviderFactoryError(
      `Provider ${provider.id} health check failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
