/**
 * @module AIConfig
 * @path packages/schemas/src/ai_config.ts
 * @description AI provider configuration schemas and validation. Defines Zod schemas for
 * validating provider settings, retry policies, timeouts, and model configurations.
 * @architectural-layer Configuration
 * @related-files [packages/core/src/config/service.ts, packages/ai/src/provider_factory.ts]
 */
import { z } from "zod";
import {
  DEFAULT_AI_MODEL,
  DEFAULT_AI_RETRY_BACKOFF_BASE_MS,
  DEFAULT_AI_RETRY_MAX_ATTEMPTS,
  DEFAULT_AI_TEMPERATURE_MAX,
  DEFAULT_AI_TEMPERATURE_MIN,
  DEFAULT_AI_TIMEOUT_MS,
  DEFAULT_MOCK_MODEL,
  DEFAULT_MOCK_STRATEGY,
  MockStrategy,
  ProviderDefaultsRegistry,
  ProviderType,
} from "@exaix/core";

/**
 * Dynamic provider type schema - validates against registered providers
 * This replaces the hardcoded enum to make provider types configurable
 */
export const ProviderTypeSchema = z.string().min(1).refine(
  (_val) => {
    // For schema validation, allow any non-empty string
    // Runtime validation will check against registered providers when the provider is created
    return true;
  },
  {
    message: "Provider type must be a non-empty string",
  },
);

/**
 * Mock strategy types
 */
export const MockStrategySchema = z.nativeEnum(MockStrategy);

export type MockStrategyType = z.infer<typeof MockStrategySchema>;

/**
 * Mock-specific configuration
 */
export const MockConfigSchema = z.object({
  /** Mock strategy: recorded, scripted, pattern, failing, slow */
  strategy: MockStrategySchema.default(DEFAULT_MOCK_STRATEGY),
  /** Directory for recorded response fixtures */
  fixtures_dir: z.string().optional(),
  /** Error message for failing strategy */
  error_message: z.string().optional(),
  /** Delay in ms for slow strategy */
  delay_ms: z.number().positive().optional(),
  /** Refuse to answer a prompt/call site with no recording, instead of falling back to
   *  patterns (Phase 157). Off by default — matches today's behaviour. */
  strict: z.boolean().optional(),
}).default({
  strategy: DEFAULT_MOCK_STRATEGY,
});

export type MockConfig = z.infer<typeof MockConfigSchema>;

/**
 * AI configuration schema for [ai] section in
 */
export const AiConfigSchema = z.object({
  /** Provider type: mock, ollama, anthropic, openai */
  provider: ProviderTypeSchema.default(ProviderType.MOCK),

  /** Model name (provider-specific) */
  model: z.string().default(DEFAULT_AI_MODEL),

  /** API endpoint URL (for ollama, custom endpoints). Empty string means use default. */
  base_url: z.string().refine(
    (val) => val === "" || z.string().url().safeParse(val).success,
    { message: "Invalid url" },
  ).optional(),

  /** Request timeout in milliseconds */
  timeout_ms: z.number().positive().default(DEFAULT_AI_TIMEOUT_MS),

  /** Max output tokens */
  max_tokens: z.number().positive().optional(),

  /** Sampling temperature (0.0 - 2.0) */
  temperature: z.number().min(DEFAULT_AI_TEMPERATURE_MIN).max(DEFAULT_AI_TEMPERATURE_MAX).optional(),

  /** Mock-specific configuration */
  mock: MockConfigSchema.optional(),
}).default({
  provider: ProviderType.MOCK,
  timeout_ms: DEFAULT_AI_TIMEOUT_MS,
});

export type AiConfig = z.infer<typeof AiConfigSchema>;

/**
 * Default AI configuration
 */
export const DEFAULT_AI_CONFIG: AiConfig = {
  provider: ProviderType.MOCK,
  model: DEFAULT_AI_MODEL,
  timeout_ms: DEFAULT_AI_TIMEOUT_MS,
};

type ProviderRegistryGlobal = typeof globalThis & {
  __exaixRegisteredProviderTypes?: string[];
};

function getSupportedProviderTypes(): string[] {
  const builtInProviderTypes = Object.values(ProviderType);
  const globalRegistry = globalThis as ProviderRegistryGlobal;
  const registeredProviderTypes = globalRegistry.__exaixRegisteredProviderTypes ?? [];

  return [...new Set([...builtInProviderTypes, ...registeredProviderTypes])];
}

function buildProviderRecord<T>(mapper: (providerType: string) => T): Record<string, T> {
  const result: Record<string, T> = {};
  for (const providerType of getSupportedProviderTypes()) {
    result[providerType] = mapper(providerType);
  }
  return result;
}
/**
 * @module AIConfigSchema
 * @path packages/schemas/src/ai_config.ts
 * @description Defines the Zod schema for AI provider configuration, including model selection, retry strategies, and mock provider settings.
 * @architectural-layer Config
 * @related-files ["packages/schemas/src/config.ts"]
 */

/**
 * Default models for each provider - now registry-driven
 */
export function getDefaultModels(): Record<string, string> {
  return buildProviderRecord(getDefaultModelForProvider);
}

/**
 * Get the default model for a specific provider type
 */
function getDefaultModelForProvider(providerType: string): string {
  if (providerType === ProviderType.MOCK) return DEFAULT_MOCK_MODEL;
  return ProviderDefaultsRegistry.getDefaultModel(providerType) ?? `${providerType}-model`;
}

/**
 * Default API endpoints for each provider - now registry-driven
 */
export function getDefaultEndpoints(): Record<string, string> {
  return buildProviderRecord(getDefaultEndpointForProvider);
}

/**
 * Get the default endpoint for a specific provider type
 */
function getDefaultEndpointForProvider(providerType: string): string {
  if (providerType === ProviderType.MOCK) return "";
  return ProviderDefaultsRegistry.getDefaultEndpoint(providerType) ?? "";
}

/**
 * Default retry configuration per provider - now registry-driven
 */
export function getDefaultRetryConfig(): Record<string, { maxAttempts: number; backoffBaseMs: number }> {
  return buildProviderRecord(getDefaultRetryConfigForProvider);
}

/**
 * Get the default retry config for a specific provider type
 */
function getDefaultRetryConfigForProvider(providerType: string): { maxAttempts: number; backoffBaseMs: number } {
  if (providerType === ProviderType.MOCK) return { maxAttempts: 1, backoffBaseMs: 0 };
  return {
    maxAttempts: ProviderDefaultsRegistry.getDefaultRetryMaxAttempts(providerType) ?? DEFAULT_AI_RETRY_MAX_ATTEMPTS,
    backoffBaseMs: ProviderDefaultsRegistry.getDefaultRetryBackoffMs(providerType) ?? DEFAULT_AI_RETRY_BACKOFF_BASE_MS,
  };
}
