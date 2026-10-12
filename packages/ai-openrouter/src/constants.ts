/**
 * @module OpenRouterPackageConstants
 * @path packages/ai-openrouter/src/constants.ts
 * @related-files ["packages/ai-openrouter/src/openrouter_provider.ts"]
 * @architectural-layer AI
 * @dependencies ["@exaix/core"]
 * @description OpenRouter-specific defaults and provider metadata owned by @exaix/ai-openrouter.
 */

import { configurable } from "@exaix/core/config";
import { ConfigValueType, SwapClass } from "@exaix/core";
import { type IProviderDefaults, ProviderCostTier, ProviderType } from "@exaix/core";

export const DEFAULT_OPENROUTER_MODEL: string = configurable({
  key: "openrouter.model",
  default: "openai/gpt-4o-mini",
  type: ConfigValueType.STRING,
  description: "Default model identifier for openrouter provider",
  swap: SwapClass.RESTART,
});
export const DEFAULT_OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
export const DEFAULT_OPENROUTER_ENDPOINT: string = configurable({
  key: "openrouter.endpoint",
  default: "https://openrouter.ai/api/v1/chat/completions",
  type: ConfigValueType.STRING,
  description: "API endpoint URL for openrouter provider",
  swap: SwapClass.RESTART,
});
export const DEFAULT_OPENROUTER_TIMEOUT_MS: number = configurable({
  key: "openrouter.timeout_ms",
  default: 60000,
  type: ConfigValueType.NUMBER,
  description: "Request timeout in milliseconds for openrouter provider",
  min: 1000,
  max: 600_000,
  swap: SwapClass.HOT,
});
export const DEFAULT_OPENROUTER_RETRY_MAX_ATTEMPTS: number = configurable({
  key: "openrouter.retry_max_attempts",
  default: 3,
  type: ConfigValueType.NUMBER,
  description: "Maximum retry attempts for openrouter provider requests",
  min: 1,
  max: 10,
  swap: SwapClass.HOT,
});
export const DEFAULT_OPENROUTER_RETRY_BACKOFF_MS: number = configurable({
  key: "openrouter.retry_backoff_ms",
  default: 1000,
  type: ConfigValueType.NUMBER,
  description: "Backoff delay in milliseconds for openrouter retries",
  min: 100,
  max: 60_000,
  swap: SwapClass.HOT,
});

/** OpenRouter ranking/analytics headers (optional but recommended). */
export const HTTP_REFERER_HEADER = "HTTP-Referer";
export const X_TITLE_HEADER = "X-Title";
export const OPENROUTER_DEFAULT_SITE_NAME = "Exaix";
export const OPENROUTER_DEFAULT_SITE_URL = "https://exaix.dev";

export const DEFAULT_OPENROUTER_CAPABILITY_CACHE_TTL_MS: number = configurable({
  key: "openrouter.capability_cache_ttl_ms",
  default: 3_600_000,
  type: ConfigValueType.NUMBER,
  description: "How long the per-model capability snapshot from the OpenRouter models endpoint stays fresh",
  min: 60_000,
  max: 86_400_000,
  swap: SwapClass.HOT,
});

/** The `supported_parameters` entry that marks a model as able to take tool definitions. */
export const OPENROUTER_TOOLS_PARAMETER = "tools";

/** Ceiling for the models endpoint body. The live catalog was 0.75 MB for 458 models on 2026-10-12. */
export const OPENROUTER_CAPABILITY_MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

/** Wait before a failed capability lookup is tried again, so each call does not wait on a dead endpoint. */
export const OPENROUTER_CAPABILITY_FAILURE_BACKOFF_MS = 60_000;

/** HTTP statuses that the OpenRouter error mapper branches on, beyond the shared 401, 403 and 429. */
export const OPENROUTER_HTTP_STATUS = {
  PAYMENT_REQUIRED: 402,
  NOT_FOUND: 404,
  REQUEST_TIMEOUT: 408,
  BAD_GATEWAY: 502,
  SERVICE_UNAVAILABLE: 503,
} as const;

/** Message fragment OpenRouter returns when no endpoint can serve the requested parameters. */
export const OPENROUTER_ROUTING_REFUSAL_PATTERN = /no endpoints found/i;

/** The 402 limit source that OpenRouter documents as safe to retry after a wait. */
export const OPENROUTER_IN_FLIGHT_BUDGET_LIMIT_SOURCE = "openrouter_in_flight_budget";

/** Cap on each upstream error string copied into a message. */
export const OPENROUTER_ERROR_FIELD_MAX_CHARS = 300;

/** Longest session key that OpenRouter accepts for sticky routing. */
export const OPENROUTER_SESSION_ID_MAX_CHARS = 256;

/** Cap on a parsed Retry-After wait, so a hostile header cannot park a caller. */
export const OPENROUTER_RETRY_AFTER_MAX_MS = 3_600_000;
export const OPENROUTER_MS_PER_SECOND = 1000;

/** Default environment variable holding the OpenRouter API key. */
export const DEFAULT_OPENROUTER_API_KEY_ENV = "OPENROUTER_API_KEY";

export const PROVIDER_OPENROUTER = ProviderType.OPENROUTER;
export const PROVIDER_OPENROUTER_DESCRIPTION = "OpenRouter unified gateway to many models";
export const PROVIDER_OPENROUTER_CAPABILITIES = ["chat", "multi-model"] as const;
export const PROVIDER_OPENROUTER_STRENGTHS = ["model-variety", "auto-fallback", "unified-billing"] as const;
export const PROVIDER_OPENROUTER_COST_TIER = ProviderCostTier.PAID;

export const OPENROUTER_CONTEXT_WINDOW = 200_000;
/** Reference routing price in USD per million tokens. */
export const OPENROUTER_COST_PER_MTok = 3;

export const OPENROUTER_PROVIDER_METADATA = {
  name: PROVIDER_OPENROUTER,
  description: PROVIDER_OPENROUTER_DESCRIPTION,
  capabilities: PROVIDER_OPENROUTER_CAPABILITIES,
  costTier: PROVIDER_OPENROUTER_COST_TIER,
  strengths: PROVIDER_OPENROUTER_STRENGTHS,
  supportsThinking: true,
  supportsEffort: true,
  contextWindow: OPENROUTER_CONTEXT_WINDOW,
  costPerMtok: OPENROUTER_COST_PER_MTok,
} as const;

export const OPENROUTER_DEFAULTS: IProviderDefaults = {
  defaultModel: DEFAULT_OPENROUTER_MODEL,
  defaultEndpoint: DEFAULT_OPENROUTER_ENDPOINT,
  defaultTimeoutMs: DEFAULT_OPENROUTER_TIMEOUT_MS,
  defaultRetryMaxAttempts: DEFAULT_OPENROUTER_RETRY_MAX_ATTEMPTS,
  defaultRetryBackoffMs: DEFAULT_OPENROUTER_RETRY_BACKOFF_MS,
};
