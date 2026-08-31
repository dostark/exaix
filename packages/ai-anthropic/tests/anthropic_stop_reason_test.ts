/**
 * @module AnthropicStopReasonTest
 * @path packages/ai-anthropic/tests/anthropic_stop_reason_test.ts
 * @related-files [packages/ai-anthropic/src/anthropic_provider.ts, packages/ai/src/provider_common_utils.ts]
 * @architectural-layer AI
 * @description The Messages API reports HOW a generation ended via stop_reason; a 200
 * response with stop_reason "max_tokens" means the output was truncated mid-generation.
 * Observed live: truncated plan JSON surfaced as a baffling "Invalid JSON:
 * Unexpected end of JSON input" three times per request because Exaix dropped stop_reason
 * entirely. The provider must propagate it on IGenerateResult so callers can distinguish
 * "model finished" from "model was cut off".
 */

import { assertEquals } from "@std/assert";
import { stub } from "@std/testing/mock";
import { AnthropicProvider } from "../mod.ts";

function anthropicSuccess(stopReason: string): Response {
  return new Response(
    JSON.stringify({
      content: [{ type: "text", text: "partial answer" }],
      stop_reason: stopReason,
      usage: { input_tokens: 10, output_tokens: 5 },
    }),
    { status: 200 },
  );
}

Deno.test("AnthropicProvider propagates stop_reason max_tokens so truncation is detectable", async () => {
  const fetchStub = stub(globalThis, "fetch", () => Promise.resolve(anthropicSuccess("max_tokens")));
  try {
    const provider = new AnthropicProvider({ apiKey: "test-key" });
    const result = await provider.generate("a long prompt");
    assertEquals(result.stop_reason, "max_tokens");
    assertEquals(result.content, "partial answer");
  } finally {
    fetchStub.restore();
  }
});

Deno.test("AnthropicProvider propagates stop_reason end_turn for a complete response", async () => {
  const fetchStub = stub(globalThis, "fetch", () => Promise.resolve(anthropicSuccess("end_turn")));
  try {
    const provider = new AnthropicProvider({ apiKey: "test-key" });
    const result = await provider.generate("a prompt");
    assertEquals(result.stop_reason, "end_turn");
  } finally {
    fetchStub.restore();
  }
});
