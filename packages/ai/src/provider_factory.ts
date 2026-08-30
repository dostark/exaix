/**
 * @module ProviderFactory
 * @path packages/ai/src/provider_factory.ts
 * @description Factory pattern implementation for instantiating LLM providers.
 * Handles configuration resolution, fallback chains, and provider initialization.
 * @architectural-layer AI Layer
 * @related-files [packages/ai/src/provider_factory.ts, packages/ai/src/provider_registry.ts]
 */

import * as DEFAULTS from "@exaix/ai/constants.ts";
import type { Config } from "@exaix/schemas";

import { type AiConfig, getDefaultModels, InputValidator, type ModelConfigSchema } from "@exaix/schemas";

import type { z } from "zod";
import type { ICostTracker, IDatabaseService, JSONValue } from "@exaix/core";
import { ConfigSource, type MockStrategy, PricingTier, ProviderType } from "@exaix/core";
import type { IEventLogger } from "@exaix/core/logger";
import { createAPIRetryPolicy, RetryPolicy } from "@exaix/core/request";
import { type IProviderMetadata, ProviderRegistry } from "./provider_registry.ts";
import { MockProviderFactory } from "./factories/mock_factory.ts";
import { AbstractKeyBasedProviderFactory } from "./factories/abstract_provider_factory.ts";
import { RateLimitedProvider } from "./rate_limited_provider.ts";
import { TracedProvider } from "./traced_provider.ts";
import type { IModelProvider, IProviderInfo, IResolvedProviderOptions } from "./types.ts";
import { ProviderFactoryError } from "./errors.ts";

import { LazyProvider } from "./providers/lazy_provider.ts";
import { CaptureRecordingProvider } from "./providers/capture_recording_provider.ts";
import type { Opt, Reason } from "@exaix/core/types";

declare const Deno: { env: { get(key: string): string | undefined } };

export type ProviderRegistryBootstrap = () => void;

let externalProviderRegistryBootstrap: ProviderRegistryBootstrap | undefined;

export function setProviderRegistryBootstrap(
  bootstrap?: Opt<ProviderRegistryBootstrap, Reason.FactoryPreset>,
): void {
  externalProviderRegistryBootstrap = bootstrap;
}

export function ensureProviderRegistryInitialized(): void {
  initializeRegistry();
  externalProviderRegistryBootstrap?.();
}

// ============================================================================
// ProviderFactory Implementation
// ============================================================================

export class ProviderFactory {
  /** Creates an LLM provider via a fallback chain: tries primary, then fallbacks, with optional health check and retry logic. */
  static async createWithFallback(
    config: Config,
    fallback: {
      primary: string;
      fallbacks: string[];
      maxRetries?: number;
      healthCheck?: boolean;
    },
    db?: Opt<IDatabaseService, Reason.OptionalDependency>,
    logger?: Opt<IEventLogger, Reason.OptionalDependency>,
    costTracker?: Opt<ICostTracker, Reason.OptionalDependency>,
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

  /** Creates an LLM provider from a named fallback chain in config.provider_strategy.fallback_chains. */
  static async createByChainName(
    config: Config,
    chainName: string,
    db?: Opt<IDatabaseService, Reason.OptionalDependency>,
    logger?: Opt<IEventLogger, Reason.OptionalDependency>,
    costTracker?: Opt<ICostTracker, Reason.OptionalDependency>,
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
  /** Creates an LLM provider; priority order: EXA_LLM_* env vars > config `[ai]` section > MockLLMProvider default. */
  static async create(
    config: Config,
    db?: Opt<IDatabaseService, Reason.OptionalDependency>,
    logger?: Opt<IEventLogger, Reason.OptionalDependency>,
    costTracker?: Opt<ICostTracker, Reason.OptionalDependency>,
  ): Promise<IModelProvider> {
    const options = this.resolveOptions(config);
    options.logger = logger;
    return await this.createAndWrap(config, options, db, costTracker);
  }

  /** Creates an LLM provider by name (e.g. "default", "fast") from the models configuration. */
  static async createByName(
    config: Config,
    name: string,
    db?: Opt<IDatabaseService, Reason.OptionalDependency>,
    logger?: Opt<IEventLogger, Reason.OptionalDependency>,
    costTracker?: Opt<ICostTracker, Reason.OptionalDependency>,
  ): Promise<IModelProvider> {
    // Check if name refers to a fallback chain
    if (config.provider_strategy?.fallback_enabled && config.provider_strategy?.fallback_chains?.[name]) {
      return await this.createByChainName(config, name, db, logger, costTracker);
    }

    const options = this.resolveOptionsByName(config, name);
    options.logger = logger;
    return await this.createAndWrap(config, options, db, costTracker);
  }

  static getProviderInfo(config: Config): IProviderInfo {
    const options = this.resolveOptions(config);
    return this.buildProviderInfo(options);
  }

  static getProviderInfoByName(config: Config, name: string): IProviderInfo {
    const options = this.resolveOptionsByName(config, name);
    return this.buildProviderInfo(options);
  }

  /** Merges env vars, modelConfig, and global config into IResolvedProviderOptions; guarantees timeoutMs is populated. */
  private static isModelConfigInput(
    rawModelConfig: JSONValue,
  ): rawModelConfig is z.input<typeof ModelConfigSchema> {
    return typeof rawModelConfig === "object" && rawModelConfig !== null && !Array.isArray(rawModelConfig);
  }

  private static resolveOptions(
    config: Config,
    rawModelConfig?: Opt<JSONValue, Reason.OptionalInput>,
  ): IResolvedProviderOptions {
    // ✓ Validate model config to prevent type confusion attacks
    const modelConfig = rawModelConfig && this.isModelConfigInput(rawModelConfig)
      ? InputValidator.validateModelConfig(rawModelConfig)
      : undefined;
    const envProvider = this.safeEnvGet("EXA_LLM_PROVIDER");
    const envModel = this.safeEnvGet("EXA_LLM_MODEL");
    // Backward compat: EXA_LLM_ENDPOINT → EXA_LLM_BASE_URL
    const envBaseUrl = this.safeEnvGet("EXA_LLM_BASE_URL") ?? this.safeEnvGet("EXA_LLM_ENDPOINT");
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
    // Ensure the registry is initialized before validation so tests and runtime
    // cannot observe a partially-registered provider set.
    ensureProviderRegistryInitialized();

    if (envProvider) {
      const normalized = envProvider.toLowerCase().trim();
      if (ProviderRegistry.getSupportedProviders().includes(normalized)) {
        providerType = normalized as ProviderType;
      } else {
        console.warn(`Unknown provider '${envProvider}' from EXA_LLM_PROVIDER, falling back to mock`);
        providerType = ProviderType.MOCK;
      }
    } else if (merged.provider) {
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

    // Reads modelConfig's own timeout_ms and config.ai's pre-fallback timeout_ms directly (not
    // merged.timeout_ms) — merged always carries baseAi's synthetic default when config.ai is
    // unset, which would otherwise shadow the config.ai_timeout.providers[providerType] branch below.
    const explicitTimeoutMs = modelConfig?.timeout_ms ?? (config.ai as AiConfig | undefined)?.timeout_ms;
    let timeoutMs = DEFAULTS.DEFAULT_AI_TIMEOUT_MS;
    if (envTimeout) {
      timeoutMs = parseInt(envTimeout, 10);
    } else if (explicitTimeoutMs) {
      timeoutMs = explicitTimeoutMs;
    } else if (config.ai_timeout && providerType !== ProviderType.MOCK) {
      const providerTimeout = config.ai_timeout.providers?.[providerType];
      if (providerTimeout) {
        timeoutMs = providerTimeout;
      }
    }

    // Mock-specific
    const mockStrategy = merged.mock?.strategy ?? baseAi?.mock?.strategy ?? DEFAULTS.DEFAULT_MOCK_STRATEGY;
    const mockFixturesDir = merged.mock?.fixtures_dir ?? baseAi?.mock?.fixtures_dir;
    // MOCK_STRICT env lets a scenario pack scope strict mode per step — the sandbox has one shared
    // exa.config.toml, so per-pack strictness can't be a config key. Unset falls back to the config value.
    const envMockStrict = this.safeEnvGet("MOCK_STRICT");
    const mockStrict = envMockStrict !== undefined
      ? envMockStrict === "1"
      : (merged.mock?.strict ?? baseAi?.mock?.strict ?? false);

    // Operator-triggered capture — env-only, never a committed config value.
    const captureFixturesDir = this.safeEnvGet("EXA_CAPTURE_FIXTURES_DIR");

    return {
      provider: providerType,
      model,
      baseUrl,
      timeoutMs,
      mockStrategy: mockStrategy as MockStrategy,
      mockFixturesDir,
      mockStrict,
      captureFixturesDir,
      config,
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
    _db?: Opt<IDatabaseService, Reason.OptionalDependency>,
    costTracker?: Opt<ICostTracker, Reason.OptionalDependency>,
  ): Promise<IModelProvider> {
    let provider = await this.createProvider(options);

    // Operator-triggered capture: wraps the real provider in a recording wrapper. Refused for mock —
    // capturing the mock's own guesses would manufacture an authoritative-looking fixture set from guesses.
    if (options.captureFixturesDir) {
      if (options.provider === ProviderType.MOCK) {
        throw new ProviderFactoryError(
          `Cannot capture fixtures from a mock provider (EXA_CAPTURE_FIXTURES_DIR is set, but the ` +
            `resolved provider is mock). Capture requires a live provider — set EXA_LLM_PROVIDER to a ` +
            `real provider for this run.`,
        );
      }
      provider = new CaptureRecordingProvider(provider, { dir: options.captureFixturesDir });
    }

    // Apply LLM call tracing when a logger is available
    if (options.logger) {
      provider = new TracedProvider(provider, options.logger);
    }

    // Apply rate limiting if enabled
    if (config.rate_limiting?.enabled) {
      const tracker = costTracker;
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
    ensureProviderRegistryInitialized();

    // Try registry first for modern providers
    const factory = ProviderRegistry.getFactory(options.provider);
    if (factory) {
      // Key-based factories validate API keys on creation, so we eagerly instantiate them —
      // missing credentials must cause create() to reject, as tests and callers expect. Other
      // factories are returned lazily to defer heavy initialization.
      if (factory instanceof AbstractKeyBasedProviderFactory) {
        return await factory.create(options);
      }

      // Use LazyProvider to defer initialization until first use
      // Provide a stable id (including mock strategy) so LazyProvider.id
      // matches what concrete factories will produce once initialized.
      const id = this.generateProviderId(options);
      return new LazyProvider(factory, options, id);
    }

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
      // `recorded` is the default strategy, but MockLLMProvider silently substitutes regex patterns
      // when no fixtures are configured. Since this id is journaled (getProviderInfoByName) for
      // auditing which responses a scenario saw, report the EFFECTIVE strategy, not the configured one.
      const configured = options.mockStrategy ?? DEFAULTS.PROVIDER_ID_MOCK_DEFAULT_STRATEGY;
      const effective = configured === DEFAULTS.PROVIDER_ID_MOCK_DEFAULT_STRATEGY && !options.mockFixturesDir
        ? DEFAULTS.PROVIDER_ID_MOCK_PATTERN_STRATEGY
        : configured;
      return `${DEFAULTS.PROVIDER_ID_MOCK_PREFIX}${effective}-${options.model}`;
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

/** Initializes package-owned provider factories in the registry; concrete extracted providers are registered separately by a root composition bootstrap. */
export function initializeRegistry(): void {
  const supported = ProviderRegistry.getSupportedProviders();

  // Mock provider - for testing and development
  if (!supported.includes(DEFAULTS.PROVIDER_MOCK)) {
    const mockMetadata: IProviderMetadata = {
      name: DEFAULTS.PROVIDER_MOCK,
      description: DEFAULTS.PROVIDER_MOCK_DESCRIPTION,
      capabilities: DEFAULTS.PROVIDER_MOCK_CAPABILITIES,
      costTier: DEFAULTS.PROVIDER_COST_TIER_FREE,
      pricingTier: PricingTier.FREE,
      strengths: DEFAULTS.PROVIDER_MOCK_STRENGTHS,
    };
    ProviderRegistry.registerWithMetadata(DEFAULTS.PROVIDER_MOCK, new MockProviderFactory(), mockMetadata);
  }
}

// ============================================================================
// Provider Validation and Health Checks
// ============================================================================

/** Validates a provider connection via a lightweight test request; used for health checks in fallback chains. */
export async function validateProviderConnection(provider: IModelProvider): Promise<void> {
  try {
    // Use a minimal test prompt that should work with any provider
    const testPrompt = DEFAULTS.PROVIDER_HEALTH_CHECK_TEST_PROMPT;
    const testOptions = {
      max_tokens: DEFAULTS.PROVIDER_HEALTH_CHECK_MAX_TOKENS,
      temperature: DEFAULTS.PROVIDER_HEALTH_CHECK_TEMPERATURE,
    };

    // Create a timeout promise with proper cleanup
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
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
