/**
 * @module OpenRouterPackageConstants
 * @path packages/ai-openrouter/src/constants.ts
 * @related-files ["packages/ai-openrouter/src/openrouter_provider.ts"]
 * @architectural-layer AI
 * @dependencies ["@exaix/core"]
 * @description OpenRouter-specific defaults and provider metadata owned by @exaix/ai-openrouter.
 */

import { type IProviderDefaults, ProviderCostTier, ProviderType } from "@exaix/core";

export const DEFAULT_OPENROUTER_MODEL = "openai/gpt-4o-mini";
export const DEFAULT_OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
export const DEFAULT_OPENROUTER_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
export const DEFAULT_OPENROUTER_TIMEOUT_MS = 60000;
export const DEFAULT_OPENROUTER_RETRY_MAX_ATTEMPTS = 3;
export const DEFAULT_OPENROUTER_RETRY_BACKOFF_MS = 1000;

/** OpenRouter ranking/analytics headers (optional but recommended). */
export const HTTP_REFERER_HEADER = "HTTP-Referer";
export const X_TITLE_HEADER = "X-Title";
export const OPENROUTER_DEFAULT_SITE_NAME = "Exaix";
export const OPENROUTER_DEFAULT_SITE_URL = "https://exaix.dev";

/** Default environment variable holding the OpenRouter API key. */
export const DEFAULT_OPENROUTER_API_KEY_ENV = "OPENROUTER_API_KEY";

export const PROVIDER_OPENROUTER = ProviderType.OPENROUTER;
export const PROVIDER_OPENROUTER_DESCRIPTION = "OpenRouter unified gateway to many models";
export const PROVIDER_OPENROUTER_CAPABILITIES = ["chat", "multi-model"] as const;
export const PROVIDER_OPENROUTER_STRENGTHS = ["model-variety", "auto-fallback", "unified-billing"] as const;
export const PROVIDER_OPENROUTER_COST_TIER = ProviderCostTier.PAID;

export const OPENROUTER_PROVIDER_METADATA = {
  name: PROVIDER_OPENROUTER,
  description: PROVIDER_OPENROUTER_DESCRIPTION,
  capabilities: PROVIDER_OPENROUTER_CAPABILITIES,
  costTier: PROVIDER_OPENROUTER_COST_TIER,
  strengths: PROVIDER_OPENROUTER_STRENGTHS,
} as const;

export const OPENROUTER_DEFAULTS: IProviderDefaults = {
  defaultModel: DEFAULT_OPENROUTER_MODEL,
  defaultEndpoint: DEFAULT_OPENROUTER_ENDPOINT,
  defaultTimeoutMs: DEFAULT_OPENROUTER_TIMEOUT_MS,
  defaultRetryMaxAttempts: DEFAULT_OPENROUTER_RETRY_MAX_ATTEMPTS,
  defaultRetryBackoffMs: DEFAULT_OPENROUTER_RETRY_BACKOFF_MS,
};
