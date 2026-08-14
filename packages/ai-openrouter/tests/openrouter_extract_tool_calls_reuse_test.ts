/**
 * @module OpenRouterExtractToolCallsReuseTest
 * @path packages/ai-openrouter/tests/openrouter_extract_tool_calls_reuse_test.ts
 * @description Phase 153 Step 4 — proves cross-provider reuse actually works, not just
 * compiles: Step 2's `extractOpenAIToolCalls()` correctly parses a fixture `IOpenRouterResponse`
 * shaped exactly like a real OpenRouter tool-call response (OpenRouter is a confirmed
 * byte-for-byte pass-through of OpenAI's tool_calls shape; `IOpenRouterResponse extends
 * Omit<OpenAIResponse, "usage">` so no second extractor was needed).
 * @architectural-layer Tests
 * @related-files [
 *   "packages/ai/src/provider_common_utils.ts",
 *   "packages/ai-openrouter/src/openrouter_reported_cost.ts"
 * ]
 */

import { assertEquals } from "@std/assert";
import { extractOpenAIToolCalls } from "@exaix/ai/provider_common_utils.ts";
import type { IOpenRouterResponse } from "../src/openrouter_reported_cost.ts";

Deno.test("extractOpenAIToolCalls (Step 2's function, reused directly) parses a real-shaped IOpenRouterResponse", () => {
  // Shaped like a real OpenRouter tool-call response: OpenAI's choices/tool_calls shape
  // plus OpenRouter's cost-carrying usage block (openrouter_reported_cost.ts).
  const response: IOpenRouterResponse = {
    choices: [{
      message: {
        tool_calls: [{
          id: "call_1",
          type: "function",
          function: { name: "patch_file", arguments: '{"path":"a.ts","diff":"..."}' },
        }],
      },
    }],
    usage: { prompt_tokens: 10, completion_tokens: 5, cost: 0.0023 },
  };

  const result = extractOpenAIToolCalls(response);
  assertEquals(result!.length, 1);
  assertEquals(result![0].id, "call_1");
  assertEquals(result![0].name, "patch_file");
  assertEquals(result![0].input, { path: "a.ts", diff: "..." });
});

Deno.test("extractOpenAIToolCalls returns undefined for a plain-content IOpenRouterResponse (no tool_calls)", () => {
  const response: IOpenRouterResponse = {
    choices: [{ message: { content: "no tools here" } }],
    usage: { prompt_tokens: 10, completion_tokens: 5 },
  };
  assertEquals(extractOpenAIToolCalls(response), undefined);
});
