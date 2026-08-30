/**
 * @module GoogleProviderToolsRequestTest
 * @path packages/ai-google/tests/google_provider_tools_request_test.ts
 * @description Phase 153 Step 3 — tests that `GoogleProvider.attemptGenerate()` serializes
 * `IModelOptions.tools`/`toolChoice`/`priorTurn` into Gemini's `tools[].functionDeclarations[]`
 * / `toolConfig.functionCallingConfig` request fields per the `IToolChoice` mapping table
 * (AUTO/ANY/ANY+allowedFunctionNames/NONE), and a `role:"model"`/`role:"user"`
 * `functionCall`/`functionResponse` priorTurn sequence.
 * @architectural-layer Tests
 * @related-files [
 *   "packages/ai-google/src/google_provider.ts",
 *   "packages/ai/tests/providers/anthropic_provider_tools_request_full_test.ts"
 * ]
 */

import { assertEquals, assertExists } from "@std/assert";
import { GoogleProvider } from "../src/google_provider.ts";
import type { JSONValue } from "@exaix/core";

interface CapturedFunctionDeclaration {
  name: string;
  description?: string;
  parameters: Record<string, JSONValue>;
}

interface CapturedToolConfig {
  functionCallingConfig: { mode: string; allowedFunctionNames?: string[] };
}

interface CapturedPart {
  text?: string;
  functionCall?: { name: string; args: Record<string, JSONValue>; thoughtSignature?: string };
  functionResponse?: { name: string; response: { content: JSONValue } };
}

interface CapturedContent {
  role?: string;
  parts: CapturedPart[];
}

interface CapturedBody {
  contents?: CapturedContent[];
  tools?: Array<{ functionDeclarations: CapturedFunctionDeclaration[] }>;
  toolConfig?: CapturedToolConfig;
}

async function capturedBodyOf(options?: Parameters<GoogleProvider["generate"]>[1]): Promise<CapturedBody> {
  const provider = new GoogleProvider({ apiKey: "test-key" });
  const origFetch = globalThis.fetch;
  let capturedBody: CapturedBody = {};
  try {
    globalThis.fetch = (_input: string | Request | URL, init?: RequestInit) => {
      capturedBody = JSON.parse((init?.body as string) ?? "{}");
      return Promise.resolve(
        new Response(
          JSON.stringify({
            candidates: [{ content: { parts: [{ text: "ok" }] } }],
            usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
          }),
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

Deno.test("GoogleProvider.attemptGenerate serializes IToolDefinition into tools[].functionDeclarations", async () => {
  const body = await capturedBodyOf({
    tools: [{
      name: "write_file",
      description: "Write content to a file",
      inputSchema: { type: "object", properties: { path: { type: "string" } } },
    }],
  });

  assertExists(body.tools);
  assertEquals(body.tools.length, 1);
  assertEquals(body.tools[0].functionDeclarations.length, 1);
  assertEquals(body.tools[0].functionDeclarations[0].name, "write_file");
  assertEquals(body.tools[0].functionDeclarations[0].description, "Write content to a file");
  assertEquals(body.tools[0].functionDeclarations[0].parameters, {
    type: "object",
    properties: { path: { type: "string" } },
  });
});

Deno.test("GoogleProvider.attemptGenerate maps IToolChoice {type:auto} to {mode:AUTO}", async () => {
  const body = await capturedBodyOf({ toolChoice: { type: "auto" } });
  assertEquals(body.toolConfig?.functionCallingConfig.mode, "AUTO");
  assertEquals(body.toolConfig?.functionCallingConfig.allowedFunctionNames, undefined);
});

Deno.test("GoogleProvider.attemptGenerate maps IToolChoice {type:any} to {mode:ANY}", async () => {
  const body = await capturedBodyOf({ toolChoice: { type: "any" } });
  assertEquals(body.toolConfig?.functionCallingConfig.mode, "ANY");
  assertEquals(body.toolConfig?.functionCallingConfig.allowedFunctionNames, undefined);
});

Deno.test("GoogleProvider.attemptGenerate maps IToolChoice {type:tool,name} to {mode:ANY,allowedFunctionNames:[name]}", async () => {
  const body = await capturedBodyOf({ toolChoice: { type: "tool", name: "patch_file" } });
  assertEquals(body.toolConfig?.functionCallingConfig.mode, "ANY");
  assertEquals(body.toolConfig?.functionCallingConfig.allowedFunctionNames, ["patch_file"]);
});

Deno.test("GoogleProvider.attemptGenerate maps IToolChoice {type:none} to {mode:NONE}", async () => {
  const body = await capturedBodyOf({ toolChoice: { type: "none" } });
  assertEquals(body.toolConfig?.functionCallingConfig.mode, "NONE");
});

Deno.test("GoogleProvider.attemptGenerate omits tools/toolConfig when absent (unchanged)", async () => {
  const body = await capturedBodyOf({});
  assertEquals(body.tools, undefined);
  assertEquals(body.toolConfig, undefined);
});

Deno.test("GoogleProvider.attemptGenerate with priorTurn produces Gemini-legal contents ordering (GAP-153-E)", async () => {
  const body = await capturedBodyOf({
    priorTurn: {
      toolUseId: "call_1",
      toolName: "patch_file",
      toolInput: { path: "a.ts", diff: "..." },
      toolResultContent: "patched successfully",
      toolResultIsError: false,
    },
  });

  assertExists(body.contents);
  // User text must lead so the replayed model functionCall has an immediately preceding
  // user turn, as required by Gemini's conversation ordering.
  assertEquals(body.contents.length, 3);
  assertEquals(body.contents[0].role, "user");
  assertEquals(body.contents[0].parts[0].text, "test prompt");

  assertEquals(body.contents[1].role, "model");
  assertExists(body.contents[1].parts[0].functionCall);
  assertEquals(body.contents[1].parts[0].functionCall!.name, "patch_file");
  assertEquals(body.contents[1].parts[0].functionCall!.args, { path: "a.ts", diff: "..." });

  assertEquals(body.contents[2].role, "user");
  assertExists(body.contents[2].parts[0].functionResponse);
  assertEquals(body.contents[2].parts[0].functionResponse!.name, "patch_file");
  assertEquals(body.contents[2].parts[0].functionResponse!.response.content, "patched successfully");
});

Deno.test("GoogleProvider.attemptGenerate replays priorTurn thoughtSignature in the model functionCall part (GAP-153-E)", async () => {
  const body = await capturedBodyOf({
    priorTurn: {
      toolUseId: "call_1",
      toolName: "patch_file",
      toolInput: { path: "a.ts", diff: "..." },
      toolResultContent: "patched successfully",
      toolResultIsError: false,
      thoughtSignature: "sig-abc123",
    },
  });

  assertExists(body.contents);
  // Gemini requires the model's replayed functionCall to carry the original
  // thought_signature; without it Gemini returns an HTTP 400 ("Function call is
  // missing a thought_signature in functionCall parts").
  assertEquals(body.contents[1].role, "model");
  assertEquals(body.contents[1].parts[0].functionCall!.name, "patch_file");
  assertEquals(body.contents[1].parts[0].functionCall!.thoughtSignature, "sig-abc123");
});

Deno.test("[regression] GoogleProvider.attemptGenerate without priorTurn produces a single content entry", async () => {
  const body = await capturedBodyOf({});
  assertEquals(body.contents?.length, 1);
  assertEquals(body.contents?.[0].parts[0].text, "test prompt");
});
