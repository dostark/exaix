/**
 * @module OpenAIProviderTest
 * @path tests/ai/openai_provider_test.ts
 * @description Verifies the OpenAI LLM provider implementation, ensuring correct
 * message formatting, tool call handling, and token usage tracking for GPT models.
 */

import { assertEquals } from "@std/assert";
import { OpenAIProvider } from "../../src/ai/providers/openai_provider.ts";
import { openaiResponseConfig, registerProviderTests, spyFetch } from "./helpers/provider_test_helper.ts";

// Register all standard provider tests
registerProviderTests<{ id: string; generate: (prompt: string) => Promise<string> }>({
  name: "OpenAIProvider",
  createProvider: (options, logger) => new OpenAIProvider({ apiKey: "test-key", ...options, logger }),
  defaultId: "openai-gpt-5-mini",
  responseConfig: openaiResponseConfig,
  apiKeyHeader: "Authorization",
  apiKeyValue: "Bearer test-key",
  stopSequenceKey: "stop",
});

// OpenAI-specific tests

Deno.test("OpenAIProvider - custom baseUrl", async () => {
  const customUrl = "https://my-proxy.com/v1/chat/completions";
  const provider = new OpenAIProvider({ apiKey: "test-key", baseUrl: customUrl });

  const { spy: fetchSpy, restore } = spyFetch(openaiResponseConfig.wrapResponse("ok"));

  try {
    await provider.generate("Hi");
    const call = fetchSpy.calls[0];
    assertEquals(call.args[0], customUrl);
  } finally {
    restore();
  }
});
