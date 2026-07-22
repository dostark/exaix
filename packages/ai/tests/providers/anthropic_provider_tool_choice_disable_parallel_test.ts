/**
 * @module AnthropicProviderToolChoiceDisableParallelTest
 * @path packages/ai/tests/providers/anthropic_provider_tool_choice_disable_parallel_test.ts
 * @description Tests tool_choice.disable_parallel_tool_use serialization.
 */

import { assertEquals, assertExists } from "@std/assert";
import { AnthropicProvider } from "@exaix/ai-anthropic";

interface CapturedBody {
  tool_choice?: { type: string; disable_parallel_tool_use?: boolean; name?: string };
}

Deno.test("tool_choice with disable_parallel_tool_use is correctly serialized", async () => {
  const provider = new AnthropicProvider({ apiKey: "test-key" });

  const origFetch = globalThis.fetch;
  let capturedBody: CapturedBody = {};
  try {
    globalThis.fetch = (_input: string | Request | URL, init?: RequestInit) => {
      capturedBody = JSON.parse((init?.body as string) ?? "{}");
      return Promise.resolve(
        new Response(
          JSON.stringify({
            content: [{ type: "text", text: "ok" }],
            usage: { input_tokens: 5, output_tokens: 3 },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    };

    await provider.generate("test", {
      tools: [{ name: "patch_file", description: "Patch", inputSchema: { type: "object" } }],
      toolChoice: { type: "any", disable_parallel_tool_use: true },
    });

    assertExists(capturedBody.tool_choice);
    assertEquals(capturedBody.tool_choice!.type, "any");
    assertEquals(capturedBody.tool_choice!.disable_parallel_tool_use, true);
  } finally {
    globalThis.fetch = origFetch;
  }
});
