/**
 * @module AnthropicContextWindowTest
 * @path packages/ai-anthropic/tests/anthropic_context_window_test.ts
 * @description The Anthropic provider's default window is the current Sonnet and Opus window, not the 200K of older models.
 * @architectural-layer Adapter
 * @dependencies [@std/assert]
 * @related-files [packages/ai-anthropic/src/constants.ts]
 */

import { assertEquals } from "@std/assert";
import { ANTHROPIC_CONTEXT_WINDOW, ANTHROPIC_PROVIDER_METADATA } from "../src/constants.ts";

Deno.test("the Anthropic default window is the current window of 1,000,000 tokens", () => {
  assertEquals(ANTHROPIC_CONTEXT_WINDOW, 1_000_000);
  assertEquals(ANTHROPIC_PROVIDER_METADATA.contextWindow, 1_000_000);
});
