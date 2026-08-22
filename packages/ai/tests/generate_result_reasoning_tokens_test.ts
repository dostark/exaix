/**
 * @module GenerateResultReasoningTokensTest
 * @path packages/ai/tests/generate_result_reasoning_tokens_test.ts
 * @description Phase 167 Step 12 — RED-first test. IGenerateResult.usage only declares
 * promptTokens/completionTokens/totalTokens/cacheReadTokens/cacheCreationTokens;
 * performProviderCall builds it from a TokenMap without carrying reasoning_tokens through,
 * even after tokenMapperAnthropic/tokenMapperOpenAI/tokenMapperGoogle parse it. Verifies
 * performProviderCall (the real construction site for IGenerateResult, called by every
 * direct-API provider) surfaces reasoningTokens on usage.
 * @architectural-layer AI
 * @related-files [packages/ai/src/provider_common_utils.ts, packages/ai/src/providers/common.ts]
 */

import { assertEquals } from "@std/assert";
import { stub } from "@std/testing/mock";
import { performProviderCall, tokenMapperAnthropic } from "@exaix/ai/provider_common_utils.ts";

const PROVIDER_ID = "anthropic-test";

function anthropicThinkingResponse(): Response {
  return new Response(
    JSON.stringify({
      content: [{ type: "text", text: "hello" }],
      usage: {
        input_tokens: 100,
        output_tokens: 2340,
        output_tokens_details: { thinking_tokens: 2048 },
      },
    }),
    { status: 200 },
  );
}

Deno.test("[GenerateResultReasoningTokens] performProviderCall surfaces reasoningTokens on IGenerateResult.usage", async () => {
  const fetchStub = stub(globalThis, "fetch", () => Promise.resolve(anthropicThinkingResponse()));
  try {
    const result = await performProviderCall("https://example.invalid/v1/messages", { method: "POST" }, {
      id: PROVIDER_ID,
      tokenMapper: tokenMapperAnthropic("claude-sonnet-5"),
    });

    assertEquals(result.usage.reasoningTokens, 2048);
    // Existing fields remain correct.
    assertEquals(result.usage.promptTokens, 100);
    assertEquals(result.usage.completionTokens, 2340);
  } finally {
    fetchStub.restore();
  }
});

Deno.test("[GenerateResultReasoningTokens] a response with no thinking breakdown produces undefined reasoningTokens, not 0", async () => {
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

    assertEquals(result.usage.reasoningTokens, undefined);
  } finally {
    fetchStub.restore();
  }
});
