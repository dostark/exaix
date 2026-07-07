/**
 * @module OllamaPackageConstants
 * @path packages/ai-ollama/src/constants.ts
 * @related-files []
 * @description Ollama- and Llama-specific defaults and provider metadata owned by @exaix/ai-ollama.
 * @architectural-layer AI
 */

import { configurable } from "@exaix/core/config";
import { ConfigValueType, SwapClass } from "@exaix/core";
import { type IProviderDefaults, ProviderCostTier, ProviderType } from "@exaix/core";

export const DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434";
export const DEFAULT_OLLAMA_ENDPOINT = configurable({
  key: "ollama.endpoint",
  default: "http://localhost:11434/api/generate",
  type: ConfigValueType.STRING,
  description: "API endpoint URL for ollama provider",
  swap: SwapClass.RESTART,
});
export const DEFAULT_OLLAMA_MODEL = configurable({
  key: "ollama.model",
  default: "llama3.2",
  type: ConfigValueType.STRING,
  description: "Default model identifier for ollama provider",
  swap: SwapClass.RESTART,
});
export const DEFAULT_OLLAMA_TIMEOUT_MS = configurable({
  key: "ollama.timeout_ms",
  default: 120000,
  type: ConfigValueType.NUMBER,
  description: "Request timeout in milliseconds for ollama provider",
  min: 1000,
  max: 600_000,
  swap: SwapClass.HOT,
});
export const DEFAULT_OLLAMA_RETRY_MAX_ATTEMPTS = configurable({
  key: "ollama.retry_max_attempts",
  default: 3,
  type: ConfigValueType.NUMBER,
  description: "Maximum retry attempts for ollama provider requests",
  min: 1,
  max: 10,
  swap: SwapClass.HOT,
});
export const DEFAULT_OLLAMA_RETRY_BACKOFF_MS = configurable({
  key: "ollama.retry_backoff_ms",
  default: 1000,
  type: ConfigValueType.NUMBER,
  description: "Backoff delay in milliseconds for ollama retries",
  min: 100,
  max: 60_000,
  swap: SwapClass.HOT,
});
export const DEFAULT_OLLAMA_EMBED_CHUNK_SIZE = 1000;
export const OLLAMA_EMBED_CACHE_MAX_ENTRIES = 512;

export const LLAMA_MODEL_PATTERN = /^(codellama:|llama[0-9.]*:)/;

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

export const OLLAMA_DEFAULTS: IProviderDefaults = {
  defaultModel: DEFAULT_OLLAMA_MODEL,
  defaultEndpoint: DEFAULT_OLLAMA_ENDPOINT,
  defaultTimeoutMs: DEFAULT_OLLAMA_TIMEOUT_MS,
  defaultRetryMaxAttempts: DEFAULT_OLLAMA_RETRY_MAX_ATTEMPTS,
  defaultRetryBackoffMs: DEFAULT_OLLAMA_RETRY_BACKOFF_MS,
};
