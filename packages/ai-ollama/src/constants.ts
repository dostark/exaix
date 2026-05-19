/**
 * @module OllamaPackageConstants
 * @path packages/ai-ollama/src/constants.ts
 * @description Ollama- and Llama-specific defaults and provider metadata owned by @exaix/ai-ollama.
 * @architectural-layer AI
 */

import { ProviderCostTier, ProviderType } from "@exaix/core";

export const DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434";
export const DEFAULT_OLLAMA_ENDPOINT = "http://localhost:11434/api/generate";
export const DEFAULT_OLLAMA_MODEL = "llama3.2";
export const DEFAULT_OLLAMA_TIMEOUT_MS = 120000;
export const DEFAULT_OLLAMA_RETRY_MAX_ATTEMPTS = 3;
export const DEFAULT_OLLAMA_RETRY_BACKOFF_MS = 1000;
export const DEFAULT_OLLAMA_EMBED_CHUNK_SIZE = 1000;
export const OLLAMA_EMBED_CACHE_MAX_ENTRIES = 512;

export const PROVIDER_OLLAMA = ProviderType.OLLAMA;
export const PROVIDER_OLLAMA_DESCRIPTION = "Local Ollama instance for running open-source models";
export const PROVIDER_OLLAMA_CAPABILITIES = ["chat", "streaming"] as const;
export const PROVIDER_OLLAMA_STRENGTHS = ["simple", "local", "privacy"] as const;
export const PROVIDER_OLLAMA_COST_TIER = ProviderCostTier.FREE;

export const OLLAMA_PROVIDER_METADATA = {
  name: PROVIDER_OLLAMA,
  description: PROVIDER_OLLAMA_DESCRIPTION,
  capabilities: PROVIDER_OLLAMA_CAPABILITIES,
  costTier: PROVIDER_OLLAMA_COST_TIER,
  strengths: PROVIDER_OLLAMA_STRENGTHS,
} as const;
