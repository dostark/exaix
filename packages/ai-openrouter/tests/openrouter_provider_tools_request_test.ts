/**
 * @module OpenRouterProviderToolsRequestTest
 * @path packages/ai-openrouter/tests/openrouter_provider_tools_request_test.ts
 * @description Phase 153 Step 4 — tests that `OpenRouterProvider.buildRequestBody()` serializes
 * `IModelOptions.tools`/`toolChoice` using the SAME OpenAI-compatible shape Step 2 implemented
 * (OpenRouter is a confirmed byte-for-byte pass-through of OpenAI's tool-calling contract), and
 * that existing OpenRouter-specific fields (`routing`/`usage.include`) coexist unaffected.
 * @architectural-layer Tests
 * @related-files [
 *   "packages/ai-openrouter/src/openrouter_provider.ts",
 *   "packages/ai/tests/provider_common_utils_openai_tools_request_test.ts"
 * ]
 */

import { assertEquals, assertExists } from "@std/assert";
import { OpenRouterProvider } from "../src/openrouter_provider.ts";
import type { IModelOptions } from "@exaix/ai/types.ts";
import type { JSONValue } from "@exaix/core";

interface CapturedTool {
  type: "function";
  function: { name: string; description?: string; parameters: Record<string, JSONValue> };
}

type CapturedToolChoice = "auto" | "none" | "required" | { type: "function"; function: { name: string } };

interface CapturedBody {
  model: string;
  messages: Array<{ role: string; content: string | null }>;
  tools?: CapturedTool[];
  tool_choice?: CapturedToolChoice;
  usage?: { include: boolean };
  models?: string[];
  provider?: Record<string, JSONValue>;
}

async function capturedBodyOf(
  options?: IModelOptions,
  providerOptions?: Partial<ConstructorParameters<typeof OpenRouterProvider>[0]>,
): Promise<CapturedBody> {
  const provider = new OpenRouterProvider({ apiKey: "test-key", ...providerOptions });
  const origFetch = globalThis.fetch;
  let capturedBody: CapturedBody = { model: "", messages: [] };
  try {
    globalThis.fetch = (_input: string | Request | URL, init?: RequestInit) => {
      capturedBody = JSON.parse((init?.body as string) ?? "{}");
      return Promise.resolve(
        new Response(
          JSON.stringify({ choices: [{ message: { content: "ok" } }] }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    };
    await provider.generate("test prompt", options);
    return capturedBody;
  } finally {
    globalThis.fetch = origFetch;
  }
}

Deno.test("OpenRouterProvider.buildRequestBody serializes IToolDefinition into tools[].function (same shape as OpenAI)", async () => {
  const body = await capturedBodyOf({
    tools: [{
      name: "patch_file",
      description: "Apply a unified diff",
      inputSchema: { type: "object", properties: { path: { type: "string" } } },
    }],
  });
  assertExists(body.tools);
  assertEquals(body.tools.length, 1);
  assertEquals(body.tools[0].type, "function");
  assertEquals(body.tools[0].function.name, "patch_file");
});

Deno.test('OpenRouterProvider.buildRequestBody maps IToolChoice {type:auto} to "auto" (identical to OpenAI)', async () => {
  const body = await capturedBodyOf({ toolChoice: { type: "auto" } });
  assertEquals(body.tool_choice, "auto");
});

Deno.test('OpenRouterProvider.buildRequestBody maps IToolChoice {type:any} to "required" (identical to OpenAI)', async () => {
  const body = await capturedBodyOf({ toolChoice: { type: "any" } });
  assertEquals(body.tool_choice, "required");
});

Deno.test("OpenRouterProvider.buildRequestBody maps IToolChoice {type:tool,name} to {type:function,function:{name}} (identical to OpenAI)", async () => {
  const body = await capturedBodyOf({ toolChoice: { type: "tool", name: "patch_file" } });
  assertEquals(body.tool_choice, { type: "function", function: { name: "patch_file" } });
});

Deno.test('OpenRouterProvider.buildRequestBody maps IToolChoice {type:none} to "none" (identical to OpenAI)', async () => {
  const body = await capturedBodyOf({ toolChoice: { type: "none" } });
  assertEquals(body.tool_choice, "none");
});

Deno.test("OpenRouterProvider.buildRequestBody: existing routing/usage.include fields coexist with tools unaffected", async () => {
  const body = await capturedBodyOf(
    { tools: [{ name: "write_file", inputSchema: { type: "object" } }], toolChoice: { type: "auto" } },
    { routing: { models: ["fallback-model"] } },
  );
  assertEquals(body.usage, { include: true });
  assertEquals(body.models, ["fallback-model"]);
  assertExists(body.tools);
  assertEquals(body.tool_choice, "auto");
});

Deno.test("[regression] OpenRouterProvider.buildRequestBody without tools omits tools/tool_choice", async () => {
  const body = await capturedBodyOf({});
  assertEquals(body.tools, undefined);
  assertEquals(body.tool_choice, undefined);
  assertEquals(body.usage, { include: true });
});
