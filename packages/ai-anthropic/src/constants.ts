/**
 * @module AnthropicPackageConstants
 * @path packages/ai-anthropic/src/constants.ts
 * @related-files []
 * @description Anthropic-specific defaults and provider metadata owned by @exaix/ai-anthropic.
 * @architectural-layer AI
 */

import { type IProviderDefaults, ProviderCostTier, ProviderType } from "@exaix/core";

export const DEFAULT_ANTHROPIC_MODEL = "claude-haiku-4-5-20251001";
export const DEFAULT_ANTHROPIC_ENDPOINT = "https://api.anthropic.com/v1/messages";
export const DEFAULT_ANTHROPIC_TIMEOUT_MS = 60000;
export const DEFAULT_ANTHROPIC_RETRY_MAX_ATTEMPTS = 5;
export const DEFAULT_ANTHROPIC_RETRY_BACKOFF_MS = 2000;
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
