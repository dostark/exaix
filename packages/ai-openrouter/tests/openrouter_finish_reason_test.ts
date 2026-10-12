/**
 * @module OpenRouterFinishReasonTest
 * @path packages/ai-openrouter/tests/openrouter_finish_reason_test.ts
 * @related-files ["packages/ai-openrouter/src/openrouter_provider.ts", "packages/ai-openrouter/src/openrouter_errors.ts"]
 * @architectural-layer AI
 * @description Verifies that a response cut off at the token limit with no content is a typed, non-retried
 * truncation error, and that other finish reasons come back as stop_reason without an error.
 */

import { assert, assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import type { JSONValue } from "@exaix/core";
import { OpenRouterProvider, OpenRouterTruncationError } from "@exaix/ai-openrouter";

function reply(
  choice: Record<string, JSONValue>,
  usage: Record<string, JSONValue> = { prompt_tokens: 10, completion_tokens: 1500, total_tokens: 1510 },
): string {
  return JSON.stringify({ choices: [choice], usage });
}

async function run<T>(
  body: string,
  fn: (provider: OpenRouterProvider, fetches: () => number) => Promise<T>,
): Promise<T> {
  const origFetch = globalThis.fetch;
  let fetches = 0;
  globalThis.fetch = (() => {
    fetches++;
    return Promise.resolve(new Response(body, { status: 200 }));
  }) as typeof fetch;
  try {
    return await fn(
      new OpenRouterProvider({ apiKey: "sk-test", model: "vendor/model", retryDelayMs: 1 }),
      () => fetches,
    );
  } finally {
    globalThis.fetch = origFetch;
  }
}

Deno.test("a length finish with empty content throws the typed truncation error once and names the cap", async () => {
  const body = reply(
    { message: { content: "" }, finish_reason: "length" },
    { prompt_tokens: 10, completion_tokens: 1500, completion_tokens_details: { reasoning_tokens: 1500 } },
  );
  await run(body, async (provider, fetches) => {
    const error = await assertRejects(() => provider.generate("hi", { max_tokens: 1500 }), OpenRouterTruncationError);
    assertStringIncludes(error.message, "max_tokens");
    assertStringIncludes(error.message, "reasoning_tokens=1500");
    assertEquals(error.reasoningTokens, 1500);
    assertEquals(fetches(), 1);
  });
});

Deno.test("a length finish with null or whitespace content is also truncation", async () => {
  for (const content of [null, "   \n"]) {
    await run(reply({ message: { content }, finish_reason: "length" }), async (provider) => {
      await assertRejects(() => provider.generate("hi"), OpenRouterTruncationError);
    });
  }
});

Deno.test("a length finish with content returns the content with stop_reason length", async () => {
  await run(reply({ message: { content: '{"partial":' }, finish_reason: "length" }), async (provider) => {
    const result = await provider.generate("hi");
    assertEquals(result.content, '{"partial":');
    assertEquals(result.stop_reason, "length");
  });
});

Deno.test("a stop finish returns stop_reason stop", async () => {
  await run(reply({ message: { content: "done" }, finish_reason: "stop" }), async (provider) => {
    assertEquals((await provider.generate("hi")).stop_reason, "stop");
  });
});

Deno.test("a tool_calls finish with empty content is not an error", async () => {
  const toolCalls = [{ id: "call_1", type: "function", function: { name: "read_file", arguments: '{"path":"a"}' } }];
  const body = reply({ message: { content: null, tool_calls: toolCalls }, finish_reason: "tool_calls" });
  await run(body, async (provider) => {
    const result = await provider.generate("hi", { tools: [{ name: "read_file", inputSchema: { type: "object" } }] });
    assertEquals(result.toolCalls?.length, 1);
    assertEquals(result.stop_reason, "tool_calls");
  });
});

Deno.test("a length finish with empty content but tool calls is not truncation", async () => {
  const toolCalls = [{ id: "call_1", type: "function", function: { name: "read_file", arguments: '{"path":"a"}' } }];
  await run(reply({ message: { content: null, tool_calls: toolCalls }, finish_reason: "length" }), async (provider) => {
    const result = await provider.generate("hi", { tools: [{ name: "read_file", inputSchema: { type: "object" } }] });
    assert(result.toolCalls?.length === 1);
  });
});

Deno.test("a response without a finish reason keeps working and has no stop_reason", async () => {
  await run(reply({ message: { content: "ok" } }), async (provider) => {
    const result = await provider.generate("hi");
    assertEquals(result.content, "ok");
    assertEquals(result.stop_reason, undefined);
  });
});
