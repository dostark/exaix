/**
 * @module AnthropicProviderToolsRequestFullTest
 * @path packages/ai/tests/providers/anthropic_provider_tools_request_full_test.ts
 * @description Tests that AnthropicProvider.attemptGenerate() serializes ALL IToolDefinition
 * fields (strict, cache_control, input_examples, type) into the real request body.
 */

import { assertEquals, assertExists } from "@std/assert";
import { AnthropicProvider } from "@exaix/ai-anthropic";

interface CapturedTool {
  name: string;
  description?: string;
  type?: string;
  strict?: boolean;
  cache_control?: { type: string; ttl?: string };
  input_examples?: Array<{ path: string }>;
}

interface CapturedBody {
  tools?: CapturedTool[];
  tool_choice?: { type: string; disable_parallel_tool_use?: boolean; name?: string };
  messages?: Array<{ role: string }>;
}

Deno.test("attemptGenerate serializes full IToolDefinition with all optional fields", async () => {
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
            usage: { input_tokens: 10, output_tokens: 5 },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    };

    await provider.generate("test prompt", {
      tools: [{
        name: "write_file",
        description: "Write content to a file",
        inputSchema: { type: "object", properties: { path: { type: "string" } } },
        type: "custom",
        strict: true,
        cache_control: { type: "ephemeral", ttl: "5m" },
        input_examples: [{ path: "/tmp/test.txt" }],
      }],
    });

    assertExists(capturedBody.tools);
    assertEquals(capturedBody.tools.length, 1);
    assertEquals(capturedBody.tools[0].name, "write_file");
    assertEquals(capturedBody.tools[0].description, "Write content to a file");
    assertEquals(capturedBody.tools[0].type, "custom");
    assertEquals(capturedBody.tools[0].strict, true);
    assertExists(capturedBody.tools[0].cache_control);
    assertEquals(capturedBody.tools[0].cache_control!.type, "ephemeral");
    assertEquals(capturedBody.tools[0].cache_control!.ttl, "5m");
    assertExists(capturedBody.tools[0].input_examples);
  } finally {
    globalThis.fetch = origFetch;
  }
});
