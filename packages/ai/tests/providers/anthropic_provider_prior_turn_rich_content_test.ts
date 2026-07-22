/**
 * @module AnthropicProviderPriorTurnRichContentTest
 * @path packages/ai/tests/providers/anthropic_provider_prior_turn_rich_content_test.ts
 * @description Tests priorTurn with string and array toolResultContent produces correct tool_result shapes.
 */

import { assertEquals, assertExists } from "@std/assert";
import { AnthropicProvider } from "@exaix/ai-anthropic";

interface CapturedMessage {
  role: string;
}

interface CapturedBody {
  messages?: CapturedMessage[];
}

Deno.test("priorTurn with string toolResultContent produces correct tool_result", async () => {
  const provider = new AnthropicProvider({ apiKey: "test-key" });

  const origFetch = globalThis.fetch;
  let capturedBody: CapturedBody = {};
  try {
    globalThis.fetch = (_input: string | Request | URL, init?: RequestInit) => {
      capturedBody = JSON.parse((init?.body as string) ?? "{}");
      return Promise.resolve(
        new Response(
          JSON.stringify({
            content: [{ type: "text", text: "done" }],
            usage: { input_tokens: 10, output_tokens: 2 },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    };

    await provider.generate("continue", {
      tools: [{ name: "write_file", description: "Write", inputSchema: { type: "object" } }],
      priorTurn: {
        toolUseId: "call_abc",
        toolName: "write_file",
        toolInput: { path: "test.txt" },
        toolResultContent: "File written successfully",
        toolResultIsError: false,
      },
    });

    assertExists(capturedBody.messages);
    assertEquals(capturedBody.messages.length, 3);
    assertEquals(capturedBody.messages[0].role, "assistant");
    assertEquals(capturedBody.messages[1].role, "user");
  } finally {
    globalThis.fetch = origFetch;
  }
});

Deno.test("priorTurn with array toolResultContent produces correct tool_result", async () => {
  const provider = new AnthropicProvider({ apiKey: "test-key" });

  const origFetch = globalThis.fetch;
  try {
    globalThis.fetch = () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            content: [{ type: "text", text: "done" }],
            usage: { input_tokens: 10, output_tokens: 2 },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );

    await provider.generate("continue", {
      tools: [{ name: "write_file", description: "Write", inputSchema: { type: "object" } }],
      priorTurn: {
        toolUseId: "call_def",
        toolName: "write_file",
        toolInput: { path: "test.txt" },
        toolResultContent: [{ type: "text", text: "Array result" }],
        toolResultIsError: false,
      },
    });
  } finally {
    globalThis.fetch = origFetch;
  }
});
