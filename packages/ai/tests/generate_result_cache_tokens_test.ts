/**
 * @module GenerateResultCacheTokensTest
 * @path packages/ai/tests/generate_result_cache_tokens_test.ts
 * @description Phase 140a Step 2 — RED-first test. IGenerateResult.usage only declares
 * promptTokens/completionTokens/totalTokens; performProviderCall builds it from a TokenMap
 * without carrying cache_read_tokens/cache_creation_tokens through, even after
 * tokenMapperAnthropic parses them. Verifies performProviderCall (the real construction site
 * for IGenerateResult, called by every direct-API provider) surfaces cacheReadTokens/
 * cacheCreationTokens on usage — consumed identically by ReActLoopStrategy and
 * LegacyAgentStrategy, since both call provider.generate() and receive the same widened
 * IGenerateResult.
 * @architectural-layer AI
 * @related-files [packages/ai/src/provider_common_utils.ts, packages/ai/src/providers/common.ts]
 */

import { assertEquals } from "@std/assert";
import { stub } from "@std/testing/mock";
import { performProviderCall, tokenMapperAnthropic } from "@exaix/ai/provider_common_utils.ts";

const PROVIDER_ID = "anthropic-test";

function anthropicCacheResponse(): Response {
  return new Response(
    JSON.stringify({
      content: [{ type: "text", text: "hello" }],
      usage: {
        input_tokens: 100,
        output_tokens: 50,
        cache_creation_input_tokens: 1000,
        cache_read_input_tokens: 200,
      },
    }),
    { status: 200 },
  );
}

Deno.test("[GenerateResultCacheTokens] performProviderCall surfaces cacheReadTokens/cacheCreationTokens on IGenerateResult.usage", async () => {
  const fetchStub = stub(globalThis, "fetch", () => Promise.resolve(anthropicCacheResponse()));
  try {
    const result = await performProviderCall("https://example.invalid/v1/messages", { method: "POST" }, {
      id: PROVIDER_ID,
      tokenMapper: tokenMapperAnthropic("claude-sonnet-5"),
    });

    assertEquals(result.usage.cacheReadTokens, 200);
    assertEquals(result.usage.cacheCreationTokens, 1000);
    // Existing fields remain correct.
    assertEquals(result.usage.promptTokens, 100);
    assertEquals(result.usage.completionTokens, 50);
  } finally {
    fetchStub.restore();
  }
});

Deno.test("[GenerateResultCacheTokens] a response with no cache fields produces undefined cacheReadTokens/cacheCreationTokens, not 0", async () => {
  const fetchStub = stub(
    globalThis,
    "fetch",
    () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            content: [{ type: "text", text: "hello" }],
            usage: { input_tokens: 10, output_tokens: 5 },
          }),
          { status: 200 },
        ),
      ),
  );
  try {
    const result = await performProviderCall("https://example.invalid/v1/messages", { method: "POST" }, {
      id: PROVIDER_ID,
      tokenMapper: tokenMapperAnthropic("claude-sonnet-5"),
    });

    assertEquals(result.usage.cacheReadTokens, undefined);
    assertEquals(result.usage.cacheCreationTokens, undefined);
  } finally {
    fetchStub.restore();
  }
});
