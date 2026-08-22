/**
 * @module AnthropicReasoningTokensTest
 * @path packages/ai/tests/anthropic_reasoning_tokens_test.ts
 * @description Phase 167 Step 12 — RED-first test. Anthropic's real Messages API response
 * includes usage.output_tokens_details.thinking_tokens when extended thinking is enabled
 * (anthropic_provider.ts sends `thinking: {type: "enabled", ...}` when a caller opts in via
 * options.thinking/config.ai_anthropic.thinking_default), but AnthropicUsage only declares
 * input_tokens/output_tokens/cache_*_tokens — the real thinking-token breakdown is dropped at
 * parse time, so a caller can never see how much of a call's billed output was invisible
 * reasoning vs. the visible response. thinking_tokens is a SUBSET of output_tokens (billed as
 * output, not additional) per Anthropic's own docs, so total token accounting is unaffected —
 * this is purely a dropped-visibility gap. Verifies tokenMapperAnthropic maps the real field
 * into TokenMap's new reasoning_tokens, and that a response with no thinking breakdown (thinking
 * disabled, or an older API response shape) produces undefined, not 0.
 * @architectural-layer AI
 * @related-files [packages/ai/src/provider_common_utils.ts]
 */

import { assertEquals } from "@std/assert";
import { tokenMapperAnthropic } from "@exaix/ai/provider_common_utils.ts";

const TEST_MODEL = "claude-sonnet-5";
const TEST_PROVIDER_ID = "anthropic";

Deno.test("[AnthropicReasoningTokens] tokenMapperAnthropic maps real output_tokens_details.thinking_tokens into TokenMap.reasoning_tokens", () => {
  const mapper = tokenMapperAnthropic(TEST_MODEL);
  const mockResponse = {
    usage: {
      input_tokens: 150,
      output_tokens: 2340,
      output_tokens_details: { thinking_tokens: 2048 },
    },
  };

  const result = mapper(mockResponse, TEST_PROVIDER_ID);

  assertEquals(result?.reasoning_tokens, 2048);
  // thinking_tokens is a SUBSET of output_tokens (billed as output) — total accounting
  // is unaffected by capturing the breakdown.
  assertEquals(result?.completion_tokens, 2340);
  assertEquals(result?.total_tokens, 150 + 2340);
});

Deno.test("[AnthropicReasoningTokens] a response with no thinking breakdown maps reasoning_tokens to undefined, not 0", () => {
  const mapper = tokenMapperAnthropic(TEST_MODEL);
  const mockResponse = {
    usage: {
      input_tokens: 100,
      output_tokens: 50,
    },
  };

  const result = mapper(mockResponse, TEST_PROVIDER_ID);

  assertEquals(result?.reasoning_tokens, undefined);
});
