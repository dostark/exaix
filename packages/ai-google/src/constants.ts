/**
 * @module GooglePackageConstants
 * @path packages/ai-google/src/constants.ts
 * @related-files []
 * @description Google-specific defaults and provider metadata owned by @exaix/ai-google.
 * @architectural-layer AI
 */

import { configurable } from "@exaix/core/config";
import { ConfigValueType, SwapClass } from "@exaix/core";
import { type IProviderDefaults, ProviderCostTier, ProviderType } from "@exaix/core";

export const DEFAULT_GOOGLE_MODEL = configurable({
  key: "google.model",
  default: "gemini-flash-latest",
  type: ConfigValueType.STRING,
  description: "Default model identifier for google provider",
  swap: SwapClass.RESTART,
});
export const DEFAULT_GOOGLE_ENDPOINT = configurable({
  key: "google.endpoint",
  default: "https://generativelanguage.googleapis.com/v1beta/models",
  type: ConfigValueType.STRING,
  description: "API endpoint URL for google provider",
  swap: SwapClass.RESTART,
});
export const DEFAULT_GOOGLE_TIMEOUT_MS = configurable({
  key: "google.timeout_ms",
  default: 30000,
  type: ConfigValueType.NUMBER,
  description: "Request timeout in milliseconds for google provider",
  min: 1000,
  max: 600_000,
  swap: SwapClass.HOT,
});
export const DEFAULT_GOOGLE_RETRY_MAX_ATTEMPTS = configurable({
  key: "google.retry_max_attempts",
  default: 3,
  type: ConfigValueType.NUMBER,
  description: "Maximum retry attempts for google provider requests",
  min: 1,
  max: 10,
  swap: SwapClass.HOT,
});
export const DEFAULT_GOOGLE_RETRY_BACKOFF_MS = configurable({
  key: "google.retry_backoff_ms",
  default: 1000,
  type: ConfigValueType.NUMBER,
  description: "Backoff delay in milliseconds for google retries",
  min: 100,
  max: 60_000,
  swap: SwapClass.HOT,
});

export const PROVIDER_GOOGLE = ProviderType.GOOGLE;
export const PROVIDER_GOOGLE_DESCRIPTION = "Google's Gemini models for multimodal AI";
export const PROVIDER_GOOGLE_CAPABILITIES = ["chat", "streaming", "vision"] as const;
export const PROVIDER_GOOGLE_STRENGTHS = ["simple", "multimodal", "fast"] as const;
export const PROVIDER_GOOGLE_COST_TIER = ProviderCostTier.FREEMIUM;

export const GOOGLE_PROVIDER_METADATA = {
  name: PROVIDER_GOOGLE,
  description: PROVIDER_GOOGLE_DESCRIPTION,
  capabilities: PROVIDER_GOOGLE_CAPABILITIES,
  costTier: PROVIDER_GOOGLE_COST_TIER,
  strengths: PROVIDER_GOOGLE_STRENGTHS,
} as const;

export const GOOGLE_DEFAULTS: IProviderDefaults = {
  defaultModel: DEFAULT_GOOGLE_MODEL,
  defaultEndpoint: DEFAULT_GOOGLE_ENDPOINT,
  defaultTimeoutMs: DEFAULT_GOOGLE_TIMEOUT_MS,
  defaultRetryMaxAttempts: DEFAULT_GOOGLE_RETRY_MAX_ATTEMPTS,
  defaultRetryBackoffMs: DEFAULT_GOOGLE_RETRY_BACKOFF_MS,
};
