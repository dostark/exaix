/**
 * @module AIConstants
 * @path src/ai/constants.ts
 * @description AI provider defaults, retry settings, and metadata used by the AI layer.
 * @architectural-layer AI
 */

import { MockStrategy, ProviderCostTier, ProviderType } from "@exaix/core";

export const DEFAULT_AI_TIMEOUT_MS = 30000;
export const DEFAULT_AI_RETRY_MAX_ATTEMPTS = 3;
export const DEFAULT_AI_RETRY_BACKOFF_BASE_MS = 1000;
export const DEFAULT_AI_RETRY_TIMEOUT_PER_REQUEST_MS = 30000;
export const DEFAULT_AI_MODEL = "gemini-flash-latest";
export const DEFAULT_AI_TEMPERATURE_MIN = 0;
export const DEFAULT_AI_TEMPERATURE_MAX = 2;
export const AI_TEMPERATURE_MIN = 0;
export const AI_TEMPERATURE_MAX = 2;
export const AI_RETRY_MAX_ATTEMPTS_MIN = 1;
export const AI_RETRY_MAX_ATTEMPTS_MAX = 10;
export const AI_RETRY_BACKOFF_BASE_MS_MIN = 100;
export const AI_RETRY_BACKOFF_BASE_MS_MAX = 10000;
export const AI_RETRY_TIMEOUT_PER_REQUEST_MS_MIN = 1000;
export const AI_RETRY_TIMEOUT_PER_REQUEST_MS_MAX = 300000;
export const AI_TIMEOUT_MS_MIN = 1000;
export const AI_TIMEOUT_MS_MAX = 300000;
export const DEFAULT_MODEL_TIMEOUT_MS = 30000;
export const DEFAULT_FAST_MODEL_TIMEOUT_MS = 15000;
export const DEFAULT_LOCAL_MODEL_TIMEOUT_MS = 60000;

export const MOCK_DELAY_MS_MIN = 0;
export const MOCK_DELAY_MS_MAX = 5000;
export const MOCK_INPUT_TOKENS_MIN = 1;
export const MOCK_INPUT_TOKENS_MAX = 10000;
export const MOCK_OUTPUT_TOKENS_MIN = 1;
export const MOCK_OUTPUT_TOKENS_MAX = 10000;
export const MOCK_DELAY_MS = 100;
export const MOCK_INPUT_TOKENS = 100;
export const MOCK_OUTPUT_TOKENS = 200;
export const DEFAULT_MOCK_MODEL = "mock-model";
export const DEFAULT_MOCK_PROVIDER_ID = "mock-provider";
export const DEFAULT_MOCK_STRATEGY = MockStrategy.RECORDED;

export const PROVIDER_MOCK_DESCRIPTION = "Mock provider for testing and development";

export const PROVIDER_CAPABILITIES_CHAT = "chat";
export const PROVIDER_CAPABILITIES_STREAMING = "streaming";
export const PROVIDER_CAPABILITIES_VISION = "vision";
export const PROVIDER_CAPABILITIES_TOOLS = "tools";

export const PROVIDER_MOCK_CAPABILITIES = [PROVIDER_CAPABILITIES_CHAT, PROVIDER_CAPABILITIES_STREAMING];

export const PROVIDER_COST_TIER_FREE = ProviderCostTier.FREE;
export const PROVIDER_COST_TIER_PAID = ProviderCostTier.PAID;
export const PROVIDER_COST_TIER_FREEMIUM = ProviderCostTier.FREEMIUM;

export const PROVIDER_MOCK_STRENGTHS = ["testing", "development"] as const;

export const DEFAULT_FAST_MODEL_NAME = "gemini-flash-latest";
export const DEFAULT_LOCAL_MODEL_NAME = "llama3.2";

export const DEFAULT_LLAMACPP_EMBED_CHUNK_SIZE = 1000;
export const DEFAULT_LLAMACPP_EMBED_BASE_URL = "http://127.0.0.1:8080";

export const PROVIDER_MOCK = ProviderType.MOCK;

export const KNOWN_PROVIDERS = [
  "mock",
] as const;

export const PROVIDER_HEALTH_CHECK_TEST_PROMPT = "Hello";
export const PROVIDER_HEALTH_CHECK_MAX_TOKENS = 1;
export const PROVIDER_HEALTH_CHECK_TEMPERATURE = 0;
export const PROVIDER_HEALTH_CHECK_TIMEOUT_MS = 5000;

export const PROVIDER_ID_MOCK_PREFIX = "mock-";
export const PROVIDER_ID_MOCK_DEFAULT_STRATEGY = "recorded";
