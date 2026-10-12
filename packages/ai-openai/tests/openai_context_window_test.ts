/**
 * @module OpenAiContextWindowTest
 * @path packages/ai-openai/tests/openai_context_window_test.ts
 * @description The OpenAI provider's default window is the current flagship window, not the 128K of older models.
 * @architectural-layer Adapter
 * @dependencies [@std/assert]
 * @related-files [packages/ai-openai/src/constants.ts]
 */

import { assertEquals } from "@std/assert";
import { OPENAI_CONTEXT_WINDOW, OPENAI_PROVIDER_METADATA } from "../src/constants.ts";

Deno.test("the OpenAI default window is the current flagship window of 1,050,000 tokens", () => {
  assertEquals(OPENAI_CONTEXT_WINDOW, 1_050_000);
  assertEquals(OPENAI_PROVIDER_METADATA.contextWindow, 1_050_000);
});
