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

export const DEFAULT_OLLAMA_RETRY_MAX_ATTEMPTS = 3;
export const DEFAULT_OLLAMA_RETRY_BACKOFF_MS = 1000;
export const DEFAULT_ANTHROPIC_RETRY_MAX_ATTEMPTS = 5;
export const DEFAULT_ANTHROPIC_RETRY_BACKOFF_MS = 2000;
export const DEFAULT_OPENAI_RETRY_MAX_ATTEMPTS = 3;
export const DEFAULT_OPENAI_RETRY_BACKOFF_MS = 1000;
export const DEFAULT_GOOGLE_RETRY_MAX_ATTEMPTS = 3;
export const DEFAULT_GOOGLE_RETRY_BACKOFF_MS = 1000;

export const DEFAULT_OPENAI_TIMEOUT_MS = 30000;
export const DEFAULT_ANTHROPIC_TIMEOUT_MS = 60000;
export const DEFAULT_GOOGLE_TIMEOUT_MS = 30000;
export const DEFAULT_OLLAMA_TIMEOUT_MS = 120000;

export const DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434";
export const DEFAULT_OLLAMA_MODEL = "llama3.2";
export const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com";
export const DEFAULT_OPENAI_MODEL = "gpt-5-mini";
export const DEFAULT_GOOGLE_MODEL = "gemini-flash-latest";
export const DEFAULT_ANTHROPIC_MODEL = "claude-haiku-4-5-20251001";
export const DEFAULT_ANTHROPIC_API_VERSION = "2023-06-01";

export const DEFAULT_OLLAMA_ENDPOINT = "http://localhost:11434/api/generate";
export const DEFAULT_ANTHROPIC_ENDPOINT = "https://api.anthropic.com/v1/messages";
export const DEFAULT_OPENAI_ENDPOINT = "https://api.openai.com/v1/chat/completions";
export const DEFAULT_GOOGLE_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

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
export const PROVIDER_OLLAMA_DESCRIPTION = "Local Ollama instance for running open-source models";
export const PROVIDER_ANTHROPIC_DESCRIPTION = "Anthropic's Claude models for high-quality AI responses";
export const PROVIDER_OPENAI_DESCRIPTION = "OpenAI's GPT models for versatile AI tasks";
export const PROVIDER_GOOGLE_DESCRIPTION = "Google's Gemini models for multimodal AI";

export const PROVIDER_CAPABILITIES_CHAT = "chat";
export const PROVIDER_CAPABILITIES_STREAMING = "streaming";
export const PROVIDER_CAPABILITIES_VISION = "vision";
export const PROVIDER_CAPABILITIES_TOOLS = "tools";

export const PROVIDER_MOCK_CAPABILITIES = [PROVIDER_CAPABILITIES_CHAT, PROVIDER_CAPABILITIES_STREAMING];
export const PROVIDER_OLLAMA_CAPABILITIES = [PROVIDER_CAPABILITIES_CHAT, PROVIDER_CAPABILITIES_STREAMING];
export const PROVIDER_ANTHROPIC_CAPABILITIES = [
  PROVIDER_CAPABILITIES_CHAT,
  PROVIDER_CAPABILITIES_STREAMING,
  PROVIDER_CAPABILITIES_VISION,
];
export const PROVIDER_OPENAI_CAPABILITIES = [
  PROVIDER_CAPABILITIES_CHAT,
  PROVIDER_CAPABILITIES_STREAMING,
  PROVIDER_CAPABILITIES_VISION,
  PROVIDER_CAPABILITIES_TOOLS,
];
export const PROVIDER_GOOGLE_CAPABILITIES = [
  PROVIDER_CAPABILITIES_CHAT,
  PROVIDER_CAPABILITIES_STREAMING,
  PROVIDER_CAPABILITIES_VISION,
];

export const PROVIDER_COST_TIER_FREE = ProviderCostTier.FREE;
export const PROVIDER_COST_TIER_PAID = ProviderCostTier.PAID;
export const PROVIDER_COST_TIER_FREEMIUM = ProviderCostTier.FREEMIUM;

export const PROVIDER_MOCK_STRENGTHS = ["testing", "development"] as const;
export const PROVIDER_OLLAMA_STRENGTHS = ["simple", "local", "privacy"] as const;
export const PROVIDER_ANTHROPIC_STRENGTHS = ["complex", "reasoning", "analysis"] as const;
export const PROVIDER_OPENAI_STRENGTHS = ["general", "creative", "complex"] as const;
export const PROVIDER_GOOGLE_STRENGTHS = ["simple", "multimodal", "fast"] as const;

export const DEFAULT_FAST_MODEL_NAME = "gemini-flash-latest";
export const DEFAULT_LOCAL_MODEL_NAME = "llama3.2";

export const DEFAULT_OLLAMA_EMBED_CHUNK_SIZE = 1000;
export const DEFAULT_OPENAI_EMBED_CHUNK_SIZE = 8000;
export const DEFAULT_LLAMACPP_EMBED_CHUNK_SIZE = 1000;
export const OLLAMA_EMBED_CACHE_MAX_ENTRIES = 512;
export const DEFAULT_OPENAI_EMBED_BASE_URL = "https://api.openai.com/v1";
export const DEFAULT_LLAMACPP_EMBED_BASE_URL = "http://127.0.0.1:8080";
export const DEFAULT_ANTHROPIC_MAX_TOKENS = 4096;

export const PROVIDER_MOCK = ProviderType.MOCK;
export const PROVIDER_OLLAMA = ProviderType.OLLAMA;
export const PROVIDER_OPENAI = ProviderType.OPENAI;
export const PROVIDER_ANTHROPIC = ProviderType.ANTHROPIC;
export const PROVIDER_GOOGLE = ProviderType.GOOGLE;

export const KNOWN_PROVIDERS = [
  "mock",
  "ollama",
  "anthropic",
  "openai",
  "google",
] as const;

export const PROVIDER_HEALTH_CHECK_TEST_PROMPT = "Hello";
export const PROVIDER_HEALTH_CHECK_MAX_TOKENS = 1;
export const PROVIDER_HEALTH_CHECK_TEMPERATURE = 0;
export const PROVIDER_HEALTH_CHECK_TIMEOUT_MS = 5000;

export const PROVIDER_ID_MOCK_PREFIX = "mock-";
export const PROVIDER_ID_MOCK_DEFAULT_STRATEGY = "recorded";
export const MODEL_ROUTING_LLAMA_PATTERN = /^(codellama:|llama[0-9.]*:)/;
