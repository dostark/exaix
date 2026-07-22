/**
 * @module ExtractAnthropicStopReasonUnchangedTest
 * @path packages/ai/tests/providers/extract_anthropic_stop_reason_unchanged_test.ts
 * @description Regression test: IGenerateResult.stop_reason wiring is unaffected by the new
 * toolCallExtractor addition in performProviderCall.
 */

import { assertEquals } from "@std/assert";
import { type AnthropicResponse, performProviderCall } from "../../src/provider_common_utils.ts";
import type { IGenerateResult } from "../../src/providers/common.ts";

Deno.test("stop_reason is still populated via stopReasonExtractor after toolCallExtractor addition", async () => {
  // Mock fetch to return a valid Anthropic response with stop_reason
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            content: [{ type: "text", text: "Hello" }],
            stop_reason: "end_turn",
            usage: { input_tokens: 10, output_tokens: 5 },
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
      );

    const result: IGenerateResult = await performProviderCall<AnthropicResponse>(
      "http://localhost:9999/v1/messages",
      { method: "POST", body: "{}", headers: {} },
      {
        id: "test-provider",
        maxAttempts: 1,
        backoffBaseMs: 1,
        timeoutMs: 1000,
        extractor: (d) => d.content?.[0]?.text ?? "",
        stopReasonExtractor: (d) => d.stop_reason,
        toolCallExtractor: (d) => {
          const calls = d.content?.filter((b) => b.type === "tool_use");
          return calls?.length
            ? calls.map((b) => ({
              id: b.id ?? "",
              name: b.name ?? "",
              input: b.input ?? {},
              type: "tool_use" as const,
            }))
            : undefined;
        },
      },
    );

    assertEquals(result.stop_reason, "end_turn");
    assertEquals(result.toolCalls, undefined); // No tool_use blocks in response
  } finally {
    globalThis.fetch = originalFetch;
  }
});
