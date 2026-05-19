/**
 * @module OpenAIPackageConstants
 * @path packages/ai-openai/src/constants.ts
 * @description OpenAI-specific defaults and provider metadata owned by @exaix/ai-openai.
 * @architectural-layer AI
 */

import { ProviderCostTier, ProviderType } from "@exaix/core";

export const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com";
export const DEFAULT_OPENAI_ENDPOINT = "https://api.openai.com/v1/chat/completions";
export const DEFAULT_OPENAI_MODEL = "gpt-5-mini";
export const DEFAULT_OPENAI_TIMEOUT_MS = 30000;
export const DEFAULT_OPENAI_RETRY_MAX_ATTEMPTS = 3;
export const DEFAULT_OPENAI_RETRY_BACKOFF_MS = 1000;
export const DEFAULT_OPENAI_EMBED_BASE_URL = "https://api.openai.com/v1";
export const DEFAULT_OPENAI_EMBED_CHUNK_SIZE = 8000;

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
