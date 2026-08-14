/**
 * @module OpenAiProviderToolsRequestTest
 * @path packages/ai-openai/tests/openai_provider_tools_request_test.ts
 * @description Phase 153 Step 2 — `OpenAIProvider.attemptGenerate()` with `options.tools`
 * set produces a real HTTP request body containing `tools[]` built from the passed
 * `IToolDefinition[]`, and a response with `tool_calls[]` populates
 * `IGenerateResult.toolCalls`. Mirrors the fetch-mock pattern used by
 * anthropic_provider_tools_request_full_test.ts.
 * @architectural-layer Tests
 * @related-files [
 *   "packages/ai-openai/src/openai_provider.ts",
 *   "packages/ai/tests/providers/anthropic_provider_tools_request_full_test.ts"
 * ]
 */

import { assertEquals, assertExists } from "@std/assert";
import { OpenAIProvider } from "../src/openai_provider.ts";
import type { JSONValue } from "@exaix/core";

interface CapturedTool {
  type: string;
  function: { name: string; description?: string; parameters: Record<string, JSONValue> };
}

type CapturedToolChoice = "auto" | "none" | "required" | { type: "function"; function: { name: string } };

interface CapturedBody {
  tools?: CapturedTool[];
  tool_choice?: CapturedToolChoice;
  messages?: Array<{ role: string; content?: string }>;
}

Deno.test("OpenAIProvider.attemptGenerate with options.tools produces a request body containing the real tools[] array", async () => {
  const provider = new OpenAIProvider({ apiKey: "test-key" });

  const origFetch = globalThis.fetch;
  let capturedBody: CapturedBody = {};
  try {
    globalThis.fetch = (_input: string | Request | URL, init?: RequestInit) => {
      capturedBody = JSON.parse((init?.body as string) ?? "{}");
      return Promise.resolve(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "ok" } }],
            usage: { prompt_tokens: 10, completion_tokens: 5 },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    };

    await provider.generate("test prompt", {
      tools: [{
        name: "patch_file",
        description: "Apply a unified diff to a file",
        inputSchema: { type: "object", properties: { path: { type: "string" } } },
      }],
      toolChoice: { type: "auto" },
    });

    assertExists(capturedBody.tools);
    assertEquals(capturedBody.tools.length, 1);
    assertEquals(capturedBody.tools[0].type, "function");
    assertEquals(capturedBody.tools[0].function.name, "patch_file");
    assertEquals(capturedBody.tool_choice, "auto");
  } finally {
    globalThis.fetch = origFetch;
  }
});

Deno.test("OpenAIProvider.attemptGenerate surfaces response tool_calls in IGenerateResult.toolCalls", async () => {
  const provider = new OpenAIProvider({ apiKey: "test-key" });

  const origFetch = globalThis.fetch;
  try {
    globalThis.fetch = () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            choices: [{
              message: {
                content: null,
                tool_calls: [{
                  id: "call_1",
                  type: "function",
                  function: { name: "patch_file", arguments: '{"path":"a.ts"}' },
                }],
              },
            }],
            usage: { prompt_tokens: 10, completion_tokens: 5 },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );

    const result = await provider.generate("test prompt", {
      tools: [{ name: "patch_file", inputSchema: { type: "object" } }],
      toolChoice: { type: "auto" },
    });

    assertExists(result.toolCalls);
    assertEquals(result.toolCalls!.length, 1);
    assertEquals(result.toolCalls![0].id, "call_1");
    assertEquals(result.toolCalls![0].name, "patch_file");
    assertEquals(result.toolCalls![0].input, { path: "a.ts" });
  } finally {
    globalThis.fetch = origFetch;
  }
});

Deno.test("[regression] OpenAIProvider.attemptGenerate without tools is unaffected — no tools field, plain content", async () => {
  const provider = new OpenAIProvider({ apiKey: "test-key" });

  const origFetch = globalThis.fetch;
  let capturedBody: CapturedBody = {};
  try {
    globalThis.fetch = (_input: string | Request | URL, init?: RequestInit) => {
      capturedBody = JSON.parse((init?.body as string) ?? "{}");
      return Promise.resolve(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "plain response" } }],
            usage: { prompt_tokens: 10, completion_tokens: 5 },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    };

    const result = await provider.generate("test prompt");

    assertEquals(capturedBody.tools, undefined);
    assertEquals(capturedBody.tool_choice, undefined);
    assertEquals(result.content, "plain response");
    assertEquals(result.toolCalls, undefined);
  } finally {
    globalThis.fetch = origFetch;
  }
});
