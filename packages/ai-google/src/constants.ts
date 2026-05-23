/**
 * @module GooglePackageConstants
 * @path packages/ai-google/src/constants.ts
 * @related-files []
 * @description Google-specific defaults and provider metadata owned by @exaix/ai-google.
 * @architectural-layer AI
 */

import { type IProviderDefaults, ProviderCostTier, ProviderType } from "@exaix/core";

export const DEFAULT_GOOGLE_MODEL = "gemini-flash-latest";
export const DEFAULT_GOOGLE_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";
export const DEFAULT_GOOGLE_TIMEOUT_MS = 30000;
export const DEFAULT_GOOGLE_RETRY_MAX_ATTEMPTS = 3;
export const DEFAULT_GOOGLE_RETRY_BACKOFF_MS = 1000;

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
