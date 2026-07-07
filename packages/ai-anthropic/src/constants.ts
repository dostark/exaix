/**
 * @module AnthropicPackageConstants
 * @path packages/ai-anthropic/src/constants.ts
 * @related-files []
 * @description Anthropic-specific defaults and provider metadata owned by @exaix/ai-anthropic.
 * @architectural-layer AI
 */

import { configurable } from "@exaix/core/config";
import { ConfigValueType, SwapClass } from "@exaix/core";
import { type IProviderDefaults, ProviderCostTier, ProviderType } from "@exaix/core";

export const DEFAULT_ANTHROPIC_MODEL: string = configurable({
  key: "anthropic.model",
  default: "claude-haiku-4-5-20251001",
  type: ConfigValueType.STRING,
  description: "Default model identifier for anthropic provider",
  swap: SwapClass.RESTART,
});
export const DEFAULT_ANTHROPIC_ENDPOINT: string = configurable({
  key: "anthropic.endpoint",
  default: "https://api.anthropic.com/v1/messages",
  type: ConfigValueType.STRING,
  description: "API endpoint URL for anthropic provider",
  swap: SwapClass.RESTART,
});
export const DEFAULT_ANTHROPIC_TIMEOUT_MS: number = configurable({
  key: "anthropic.timeout_ms",
  default: 60000,
  type: ConfigValueType.NUMBER,
  description: "Request timeout in milliseconds for anthropic provider",
  min: 1000,
  max: 600_000,
  swap: SwapClass.HOT,
});
export const DEFAULT_ANTHROPIC_RETRY_MAX_ATTEMPTS: number = configurable({
  key: "anthropic.retry_max_attempts",
  default: 5,
  type: ConfigValueType.NUMBER,
  description: "Maximum retry attempts for anthropic provider requests",
  min: 1,
  max: 10,
  swap: SwapClass.HOT,
});
export const DEFAULT_ANTHROPIC_RETRY_BACKOFF_MS: number = configurable({
  key: "anthropic.retry_backoff_ms",
  default: 2000,
  type: ConfigValueType.NUMBER,
  description: "Backoff delay in milliseconds for anthropic retries",
  min: 100,
  max: 60_000,
  swap: SwapClass.HOT,
});
export const DEFAULT_ANTHROPIC_API_VERSION = "2023-06-01";
export const DEFAULT_ANTHROPIC_MAX_TOKENS = 4096;

export const PROVIDER_ANTHROPIC = ProviderType.ANTHROPIC;
export const PROVIDER_ANTHROPIC_DESCRIPTION = "Anthropic's Claude models for high-quality AI responses";
export const PROVIDER_ANTHROPIC_CAPABILITIES = ["chat", "streaming", "vision"] as const;
export const PROVIDER_ANTHROPIC_STRENGTHS = ["complex", "reasoning", "analysis"] as const;
export const PROVIDER_ANTHROPIC_COST_TIER = ProviderCostTier.PAID;

export const ANTHROPIC_PROVIDER_METADATA = {
  name: PROVIDER_ANTHROPIC,
  description: PROVIDER_ANTHROPIC_DESCRIPTION,
  capabilities: PROVIDER_ANTHROPIC_CAPABILITIES,
  costTier: PROVIDER_ANTHROPIC_COST_TIER,
  strengths: PROVIDER_ANTHROPIC_STRENGTHS,
} as const;

export const ANTHROPIC_DEFAULTS: IProviderDefaults = {
  defaultModel: DEFAULT_ANTHROPIC_MODEL,
  defaultEndpoint: DEFAULT_ANTHROPIC_ENDPOINT,
  defaultTimeoutMs: DEFAULT_ANTHROPIC_TIMEOUT_MS,
  defaultRetryMaxAttempts: DEFAULT_ANTHROPIC_RETRY_MAX_ATTEMPTS,
  defaultRetryBackoffMs: DEFAULT_ANTHROPIC_RETRY_BACKOFF_MS,
};

/** Content block type for Anthropic Messages API text blocks. */
export const ANTHROPIC_CONTENT_TYPE_TEXT = "text";

/** Cache control type for ephemeral prompt caching. */
export const ANTHROPIC_CACHE_CONTROL_EPHEMERAL = "ephemeral";
