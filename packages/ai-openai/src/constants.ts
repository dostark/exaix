/**
 * @module OpenAIPackageConstants
 * @path packages/ai-openai/src/constants.ts
 * @related-files []
 * @description OpenAI-specific defaults and provider metadata owned by @exaix/ai-openai.
 * @architectural-layer AI
 */

import { configurable } from "@exaix/core/config";
import { ConfigValueType, SwapClass } from "@exaix/core";
import { type IProviderDefaults, ProviderCostTier, ProviderType } from "@exaix/core";

export const DEFAULT_OPENAI_MODEL: string = configurable({
  key: "openai.model",
  default: "gpt-5-mini",
  type: ConfigValueType.STRING,
  description: "Default model identifier for openai provider",
  swap: SwapClass.RESTART,
});
export const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com";
export const DEFAULT_OPENAI_ENDPOINT: string = configurable({
  key: "openai.endpoint",
  default: "https://api.openai.com/v1/chat/completions",
  type: ConfigValueType.STRING,
  description: "API endpoint URL for openai provider",
  swap: SwapClass.RESTART,
});
export const DEFAULT_OPENAI_EMBED_BASE_URL = "https://api.openai.com/v1";
export const DEFAULT_OPENAI_EMBED_CHUNK_SIZE = 8000;
export const DEFAULT_OPENAI_TIMEOUT_MS: number = configurable({
  key: "openai.timeout_ms",
  default: 30000,
  type: ConfigValueType.NUMBER,
  description: "Request timeout in milliseconds for openai provider",
  min: 1000,
  max: 600_000,
  swap: SwapClass.HOT,
});
export const DEFAULT_OPENAI_RETRY_MAX_ATTEMPTS: number = configurable({
  key: "openai.retry_max_attempts",
  default: 3,
  type: ConfigValueType.NUMBER,
  description: "Maximum retry attempts for openai provider requests",
  min: 1,
  max: 10,
  swap: SwapClass.HOT,
});
export const DEFAULT_OPENAI_RETRY_BACKOFF_MS: number = configurable({
  key: "openai.retry_backoff_ms",
  default: 1000,
  type: ConfigValueType.NUMBER,
  description: "Backoff delay in milliseconds for openai retries",
  min: 100,
  max: 60_000,
  swap: SwapClass.HOT,
});

export const PROVIDER_OPENAI = ProviderType.OPENAI;
export const PROVIDER_OPENAI_DESCRIPTION = "OpenAI's GPT models for versatile AI tasks";
export const PROVIDER_OPENAI_CAPABILITIES = ["chat", "streaming", "vision", "tools"] as const;
export const PROVIDER_OPENAI_STRENGTHS = ["general", "creative", "complex"] as const;
export const PROVIDER_OPENAI_COST_TIER = ProviderCostTier.PAID;

export const OPENAI_PROVIDER_METADATA = {
  name: PROVIDER_OPENAI,
  description: PROVIDER_OPENAI_DESCRIPTION,
  capabilities: PROVIDER_OPENAI_CAPABILITIES,
  costTier: PROVIDER_OPENAI_COST_TIER,
  strengths: PROVIDER_OPENAI_STRENGTHS,
} as const;

export const OPENAI_DEFAULTS: IProviderDefaults = {
  defaultModel: DEFAULT_OPENAI_MODEL,
  defaultEndpoint: DEFAULT_OPENAI_ENDPOINT,
  defaultTimeoutMs: DEFAULT_OPENAI_TIMEOUT_MS,
  defaultRetryMaxAttempts: DEFAULT_OPENAI_RETRY_MAX_ATTEMPTS,
  defaultRetryBackoffMs: DEFAULT_OPENAI_RETRY_BACKOFF_MS,
};
