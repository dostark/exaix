/**
 * @module ProviderCommonUtilsOpenAiToolsRequestTest
 * @path packages/ai/tests/provider_common_utils_openai_tools_request_test.ts
 * @description Phase 153 Step 2 — tests that `createOpenAIChatCompletionsRequestInit()`
 * serializes `IModelOptions.tools`/`toolChoice`/`priorTurn` into OpenAI's real Chat
 * Completions wire format: `tools[].function.{name,description,parameters}`,
 * `tool_choice` per the `IToolChoice` mapping table (auto/required/{type:function,...}/none),
 * and a 3-message `priorTurn` sequence (assistant tool_calls, tool result, user).
 * @architectural-layer Tests
 * @related-files [
 *   "packages/ai/src/provider_common_utils.ts",
 *   "packages/ai/tests/providers/anthropic_provider_tools_request_full_test.ts"
 * ]
 */

import { assertEquals, assertExists } from "@std/assert";
import { createOpenAIChatCompletionsRequestInit } from "../src/provider_common_utils.ts";
import type { IModelOptions } from "../src/types.ts";
import type { JSONValue } from "@exaix/core";

interface CapturedOpenAiTool {
  type: "function";
  function: { name: string; description?: string; parameters: Record<string, JSONValue> };
}

interface CapturedOpenAiMessage {
  role: string;
  content: string | null;
  tool_call_id?: string;
  tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }>;
}

interface CapturedBody {
  model: string;
  messages: CapturedOpenAiMessage[];
  tools?: CapturedOpenAiTool[];
  tool_choice?: "auto" | "none" | "required" | { type: "function"; function: { name: string } };
  max_completion_tokens?: number;
  max_tokens?: number;
}

function capturedBodyOf(options?: IModelOptions): CapturedBody {
  const init = createOpenAIChatCompletionsRequestInit("test-key", "gpt-5", "test prompt", options);
  return JSON.parse(init.body as string);
}

Deno.test("createOpenAIChatCompletionsRequestInit serializes IToolDefinition into tools[].function", () => {
  const body = capturedBodyOf({
    tools: [{
      name: "write_file",
      description: "Write content to a file",
      inputSchema: { type: "object", properties: { path: { type: "string" } } },
    }],
  });

  assertExists(body.tools);
  assertEquals(body.tools.length, 1);
  assertEquals(body.tools[0].type, "function");
  assertEquals(body.tools[0].function.name, "write_file");
  assertEquals(body.tools[0].function.description, "Write content to a file");
  assertEquals(body.tools[0].function.parameters, { type: "object", properties: { path: { type: "string" } } });
});

Deno.test('createOpenAIChatCompletionsRequestInit maps IToolChoice {type:auto} to "auto"', () => {
  const body = capturedBodyOf({ toolChoice: { type: "auto" } });
  assertEquals(body.tool_choice, "auto");
});

Deno.test('createOpenAIChatCompletionsRequestInit maps IToolChoice {type:any} to "required"', () => {
  const body = capturedBodyOf({ toolChoice: { type: "any" } });
  assertEquals(body.tool_choice, "required");
});

Deno.test("createOpenAIChatCompletionsRequestInit maps IToolChoice {type:tool,name} to {type:function,function:{name}}", () => {
  const body = capturedBodyOf({ toolChoice: { type: "tool", name: "patch_file" } });
  assertEquals(body.tool_choice, { type: "function", function: { name: "patch_file" } });
});

Deno.test('createOpenAIChatCompletionsRequestInit maps IToolChoice {type:none} to "none"', () => {
  const body = capturedBodyOf({ toolChoice: { type: "none" } });
  assertEquals(body.tool_choice, "none");
});

Deno.test("createOpenAIChatCompletionsRequestInit omits tool_choice when toolChoice is absent", () => {
  const body = capturedBodyOf({});
  assertEquals(body.tool_choice, undefined);
});

Deno.test("createOpenAIChatCompletionsRequestInit with priorTurn produces the 3-message sequence in order", () => {
  const body = capturedBodyOf({
    priorTurn: {
      toolUseId: "call_1",
      toolName: "patch_file",
      toolInput: { path: "a.ts", diff: "..." },
      toolResultContent: "patched successfully",
      toolResultIsError: false,
    },
  });

  assertEquals(body.messages.length, 3);

  assertEquals(body.messages[0].role, "assistant");
  assertEquals(body.messages[0].content, null);
  assertExists(body.messages[0].tool_calls);
  assertEquals(body.messages[0].tool_calls!.length, 1);
  assertEquals(body.messages[0].tool_calls![0].id, "call_1");
  assertEquals(body.messages[0].tool_calls![0].type, "function");
  assertEquals(body.messages[0].tool_calls![0].function.name, "patch_file");
  assertEquals(JSON.parse(body.messages[0].tool_calls![0].function.arguments), { path: "a.ts", diff: "..." });

  assertEquals(body.messages[1].role, "tool");
  assertEquals(body.messages[1].tool_call_id, "call_1");
  assertEquals(body.messages[1].content, "patched successfully");

  assertEquals(body.messages[2].role, "user");
  assertEquals(body.messages[2].content, "test prompt");
});

Deno.test("createOpenAIChatCompletionsRequestInit with priorTurn stringifies rich-content toolResultContent for OpenAI's string-only tool message", () => {
  const body = capturedBodyOf({
    priorTurn: {
      toolUseId: "call_2",
      toolName: "read_file",
      toolInput: { path: "b.ts" },
      toolResultContent: [{ type: "text", text: "file contents" }],
      toolResultIsError: false,
    },
  });

  assertEquals(typeof body.messages[1].content, "string");
  assertEquals(JSON.parse(body.messages[1].content as string), [{ type: "text", text: "file contents" }]);
});

Deno.test("createOpenAIChatCompletionsRequestInit without priorTurn produces a single user message (unchanged)", () => {
  const body = capturedBodyOf({});
  assertEquals(body.messages.length, 1);
  assertEquals(body.messages[0].role, "user");
  assertEquals(body.messages[0].content, "test prompt");
});

Deno.test(
  "createOpenAIChatCompletionsRequestInit serializes max_tokens as max_completion_tokens (OpenAI deprecated max_tokens; incompatible with o-series/gpt-5 reasoning models)",
  () => {
    const body = capturedBodyOf({ max_tokens: 8192 });
    assertEquals(body.max_completion_tokens, 8192);
    assertEquals(body.max_tokens, undefined);
  },
);
