/**
 * @module OpenAIReasoningTokensTest
 * @path packages/ai/tests/openai_reasoning_tokens_test.ts
 * @description Phase 167 Step 12 — RED-first test. OpenAI's reasoning models (o1/o3/gpt-5
 * family) report usage.completion_tokens_details.reasoning_tokens on the Chat Completions API
 * (official docs: https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create),
 * but OpenAIUsage only declares prompt_tokens/completion_tokens/total_tokens — the real
 * reasoning-token breakdown is dropped at parse time. reasoning_tokens is a SUBSET of
 * completion_tokens (billed as output, not additional), so total accounting is unaffected —
 * this is purely a dropped-visibility gap, the same class as GAP-14's Codex finding. Verifies
 * tokenMapperOpenAI maps the real field into TokenMap.reasoning_tokens, and that a response
 * with no reasoning breakdown (a non-reasoning model, e.g. gpt-4o) produces undefined, not 0.
 * @architectural-layer AI
 * @related-files [packages/ai/src/provider_common_utils.ts]
 */

import { assertEquals } from "@std/assert";
import { tokenMapperOpenAI } from "@exaix/ai/provider_common_utils.ts";

const TEST_PROVIDER_ID = "openai";

Deno.test("[OpenAIReasoningTokens] tokenMapperOpenAI maps real completion_tokens_details.reasoning_tokens into TokenMap.reasoning_tokens", () => {
  const mapper = tokenMapperOpenAI("gpt-5.2-codex");
  const mockResponse = {
    usage: {
      prompt_tokens: 150,
      completion_tokens: 2340,
      total_tokens: 2490,
      completion_tokens_details: { reasoning_tokens: 2048 },
    },
  };

  const result = mapper(mockResponse, TEST_PROVIDER_ID);

  assertEquals(result?.reasoning_tokens, 2048);
  // reasoning_tokens is a SUBSET of completion_tokens (billed as output) — total accounting
  // is unaffected by capturing the breakdown.
  assertEquals(result?.completion_tokens, 2340);
  assertEquals(result?.total_tokens, 2490);
});

Deno.test("[OpenAIReasoningTokens] a non-reasoning-model response with no breakdown maps reasoning_tokens to undefined, not 0", () => {
  const mapper = tokenMapperOpenAI("gpt-4o");
  const mockResponse = {
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  };

  const result = mapper(mockResponse, TEST_PROVIDER_ID);

  assertEquals(result?.reasoning_tokens, undefined);
});
