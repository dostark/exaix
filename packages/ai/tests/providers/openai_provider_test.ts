/**
 * @module OpenAIProviderTest
 * @path packages/ai/tests/providers/openai_provider_test.ts
 * @related-files []
 * @architectural-layer AI
 * @description Verifies the OpenAI LLM provider implementation, ensuring correct
 * message formatting, tool call handling, and token usage tracking for GPT models.
 */

import { assertEquals } from "@std/assert";
import { OpenAIProvider } from "@exaix/ai-openai";
import type { IGenerateResult } from "../../src/providers/common.ts";
import { openaiResponsesResponseConfig, registerProviderTests, spyFetch } from "../helpers/provider_test_helper.ts";

// Register all standard provider tests
registerProviderTests<{ id: string; generate: (prompt: string) => Promise<IGenerateResult> }>({
  name: "OpenAIProvider",
  createProvider: (options, logger) => new OpenAIProvider({ apiKey: "test-key", ...options, logger }),
  defaultId: "openai-gpt-5-mini",
  responseConfig: openaiResponsesResponseConfig,
  apiKeyHeader: "Authorization",
  apiKeyValue: "Bearer test-key",
  // The Responses API has no stop-sequence field, so the stop option is not sent.
  stopSequenceKey: null,
});

// OpenAI-specific tests

Deno.test("OpenAIProvider - custom baseUrl", async () => {
  const customUrl = "https://my-proxy.com/v1/chat/completions";
  const provider = new OpenAIProvider({ apiKey: "test-key", baseUrl: customUrl });

  const { spy: fetchSpy, restore } = spyFetch(openaiResponsesResponseConfig.wrapResponse("ok"));

  try {
    await provider.generate("Hi");
    const call = fetchSpy.calls[0];
    assertEquals(
      call.args[0],
      "https://my-proxy.com/v1/responses",
      "the Responses endpoint sits beside the configured one",
    );
  } finally {
    restore();
  }
});
