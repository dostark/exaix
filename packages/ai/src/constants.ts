/**
 * @module AIConstants
 * @path packages/ai/src/constants.ts
 * @related-files []
 * @description AI provider defaults, retry settings, and metadata used by the AI layer.
 *   Duplicate defaults are re-exported from @exaix/core to avoid conflicting
 *   sources of truth — the central configurable() registry in core is authoritative.
 * @architectural-layer AI
 * @ungrounded
 */

import { configurable } from "@exaix/core/config";
import { ConfigValueType, ProviderCostTier, ProviderType, SwapClass } from "@exaix/core";

// Re-export canonical defaults from core (single source of truth)
export {
  DEFAULT_AI_MODEL,
  DEFAULT_AI_RETRY_BACKOFF_BASE_MS,
  DEFAULT_AI_RETRY_MAX_ATTEMPTS,
  DEFAULT_AI_RETRY_TIMEOUT_PER_REQUEST_MS,
  DEFAULT_AI_TEMPERATURE_MAX,
  DEFAULT_AI_TEMPERATURE_MIN,
  DEFAULT_AI_TIMEOUT_MS,
  DEFAULT_FAST_MODEL_NAME,
  DEFAULT_LOCAL_MODEL_NAME,
  DEFAULT_MOCK_MODEL,
  DEFAULT_MOCK_STRATEGY,
  MOCK_DELAY_MS,
  MOCK_INPUT_TOKENS,
  MOCK_OUTPUT_TOKENS,
} from "@exaix/core";

// AI-package-local tunable defaults (not duplicated in core)
export const DEFAULT_MODEL_TIMEOUT_MS = configurable({
  key: "ai.model_timeout_ms",
  default: 30000,
  type: ConfigValueType.NUMBER,
  description: "Default timeout in milliseconds for AI model requests",
  min: 1000,
  max: 300_000,
  swap: SwapClass.HOT,
});
export const DEFAULT_FAST_MODEL_TIMEOUT_MS = configurable({
  key: "ai.fast_model_timeout_ms",
  default: 15000,
  type: ConfigValueType.NUMBER,
  description: "Timeout in milliseconds for fast AI model requests",
  min: 1000,
  max: 300_000,
  swap: SwapClass.HOT,
});
export const DEFAULT_LOCAL_MODEL_TIMEOUT_MS = configurable({
  key: "ai.local_model_timeout_ms",
  default: 60000,
  type: ConfigValueType.NUMBER,
  description: "Timeout in milliseconds for local AI model requests",
  min: 1000,
  max: 600_000,
  swap: SwapClass.HOT,
});

export const DEFAULT_MOCK_PROVIDER_ID = "mock-provider";

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
