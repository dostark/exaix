/**
 * @module AnthropicProviderTest
 * @path tests/ai/anthropic_provider_test.ts
 * @description Verifies the Anthropic LLM provider implementation, ensuring correct
 * message formatting, tool call handling, and token usage tracking for Claude models.
 */

import { AnthropicProvider } from "@exaix/ai-anthropic";
import type { IGenerateResult } from "../../src/providers/common.ts";
import { anthropicResponseConfig, registerProviderTests } from "../helpers/provider_test_helper.ts";

// Register all standard provider tests
registerProviderTests<{ id: string; generate: (prompt: string) => Promise<IGenerateResult> }>({
  name: "AnthropicProvider",
  createProvider: (options, logger) => new AnthropicProvider({ apiKey: "test-key", ...options, logger }),
  defaultId: "anthropic-claude-haiku-4-5-20251001",
  responseConfig: anthropicResponseConfig,
  apiKeyHeader: "x-api-key",
  apiKeyValue: "test-key",
  additionalHeaders: { "anthropic-version": "2023-06-01" },
  stopSequenceKey: "stop_sequences",
});
