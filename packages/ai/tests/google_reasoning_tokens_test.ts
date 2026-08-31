/**
 * @module GoogleReasoningTokensTest
 * @path packages/ai/tests/google_reasoning_tokens_test.ts
 * @description Phase 167 Step 12 — RED-first test. Gemini's real API response includes
 * usageMetadata.thoughtsTokenCount when the model does internal reasoning — for
 * DEFAULT_GOOGLE_MODEL ("gemini-flash-latest", a 2.5+-class model), dynamic thinking is
 * enabled BY DEFAULT (no explicit thinkingConfig required), so this field is already present
 * in live responses, not merely a hypothetical opt-in surface (verified against official
 * Google documentation: "Gemini 2.5 Flash defaults to a dynamic thinking budget").
 * GoogleUsageMetadata only declares promptTokenCount/candidatesTokenCount/totalTokenCount —
 * the real thinking-token count is dropped at parse time. With the Gemini API,
 * candidatesTokenCount already INCLUDES thinking tokens (a subset, not additional), so total
 * accounting is unaffected — this is purely a dropped-visibility gap. Verifies
 * tokenMapperGoogle maps the real field into TokenMap.reasoning_tokens, and that a response
 * with no thoughtsTokenCount (thinking produced no tokens, or an endpoint that omits it)
 * produces undefined, not 0.
 * @architectural-layer AI
 * @related-files [packages/ai/src/provider_common_utils.ts]
 */

import { assertEquals } from "@std/assert";
import { tokenMapperGoogle } from "@exaix/ai/provider_common_utils.ts";

const TEST_PROVIDER_ID = "google";

Deno.test("[GoogleReasoningTokens] tokenMapperGoogle maps real usageMetadata.thoughtsTokenCount into TokenMap.reasoning_tokens", () => {
  const mapper = tokenMapperGoogle("gemini-flash-latest");
  const mockResponse = {
    usageMetadata: {
      promptTokenCount: 150,
      candidatesTokenCount: 2340,
      totalTokenCount: 2490,
      thoughtsTokenCount: 2048,
    },
  };

  const result = mapper(mockResponse, TEST_PROVIDER_ID);

  assertEquals(result?.reasoning_tokens, 2048);
  // With the Gemini API, candidatesTokenCount already includes thinking tokens — total
  // accounting is unaffected by capturing the breakdown.
  assertEquals(result?.completion_tokens, 2340);
  assertEquals(result?.total_tokens, 2490);
});

Deno.test("[GoogleReasoningTokens] a response with no thoughtsTokenCount maps reasoning_tokens to undefined, not 0", () => {
  const mapper = tokenMapperGoogle("gemini-flash-latest");
  const mockResponse = {
    usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 },
  };

  const result = mapper(mockResponse, TEST_PROVIDER_ID);

  assertEquals(result?.reasoning_tokens, undefined);
});
