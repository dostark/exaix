/**
 * @module OpenAiReasoningEffortClampTest
 * @path packages/ai/tests/openai_reasoning_effort_clamp_test.ts
 * @description OpenAI-family reasoning models take low to high. The two higher tiers clamp to high, so no caller tier reaches the API unsupported.
 * @architectural-layer Test
 * @related-files ["packages/ai/src/provider_common_utils.ts"]
 */

import { assertEquals } from "@std/assert";
import { openAiReasoningEffort } from "../src/provider_common_utils.ts";

Deno.test("openAiReasoningEffort clamps xhigh and max to high and keeps the lower tiers", () => {
  assertEquals(openAiReasoningEffort("xhigh"), "high");
  assertEquals(openAiReasoningEffort("max"), "high");
  assertEquals(openAiReasoningEffort("low"), "low");
  assertEquals(openAiReasoningEffort("medium"), "medium");
  assertEquals(openAiReasoningEffort(undefined), undefined);
});
