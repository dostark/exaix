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
  parallel_tool_calls?: boolean;
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

Deno.test("OpenRouterProvider.buildRequestBody sends IToolChoice {type:any} as the named function when one tool is offered", async () => {
  const body = await capturedBodyOf({ toolChoice: { type: "any" }, tools: [OR_READ_TOOL] });
  assertEquals(body.tool_choice, { type: "function", function: { name: OR_READ_TOOL.name } });
});

Deno.test('OpenRouterProvider.buildRequestBody sends IToolChoice {type:any} as "auto" when several tools are offered', async () => {
  const body = await capturedBodyOf({
    toolChoice: { type: "any" },
    tools: [OR_READ_TOOL, { ...OR_READ_TOOL, name: "list_directory" }],
  });
  assertEquals(body.tool_choice, "auto");
});

Deno.test("OpenRouterProvider.buildRequestBody maps IToolChoice {type:tool,name} to {type:function,function:{name}} (identical to OpenAI)", async () => {
  const body = await capturedBodyOf({ toolChoice: { type: "tool", name: "patch_file" } });
  assertEquals(body.tool_choice, { type: "function", function: { name: "patch_file" } });
});

Deno.test('OpenRouterProvider.buildRequestBody maps IToolChoice {type:none} to "none" (identical to OpenAI)', async () => {
  const body = await capturedBodyOf({ toolChoice: { type: "none" } });
  assertEquals(body.tool_choice, "none");
});

Deno.test("OpenRouterProvider.buildRequestBody: routing fields coexist with tools and the body has no deprecated usage flag", async () => {
  const body = await capturedBodyOf(
    { tools: [{ name: "write_file", inputSchema: { type: "object" } }], toolChoice: { type: "auto" } },
    { routing: { models: ["fallback-model"] } },
  );
  assertEquals(body.usage, undefined);
  assertEquals(body.models, ["fallback-model"]);
  assertEquals(body.provider, { require_parameters: true });
  assertExists(body.tools);
  assertEquals(body.tool_choice, "auto");
});

Deno.test("[regression] OpenRouterProvider.buildRequestBody without tools omits tools/tool_choice", async () => {
  const body = await capturedBodyOf({});
  assertEquals(body.tools, undefined);
  assertEquals(body.tool_choice, undefined);
  assertEquals(body.usage, undefined);
});

const OR_READ_TOOL = {
  name: "read_file",
  inputSchema: { type: "object", properties: { path: { type: "string" } } },
};

const OR_TOOL_CALLS = [
  { id: "call_a", type: "function", function: { name: "read_file", arguments: '{"path":"a.ts"}' } },
  { id: "call_b", type: "function", function: { name: "read_file", arguments: '{"path":"b.ts"}' } },
];

const OR_REASONING_DETAILS = [
  { type: "reasoning.text", text: "Read both first.", signature: "sig-r" },
  { type: "reasoning.summary", summary: "Two reads." },
];

/** A two-call OpenRouter response with assistant text, reasoning content and ordered reasoning details. */
function openRouterTwoCallResponse(): Record<string, JSONValue> {
  return {
    model: "openrouter-test",
    choices: [{
      message: {
        content: "I will read both files.",
        reasoning_content: "Read both first.",
        reasoning_details: OR_REASONING_DETAILS,
        tool_calls: OR_TOOL_CALLS,
      },
    }],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  };
}

function scriptOpenRouterFetch(
  bodies: Array<Record<string, JSONValue>>,
): { sent: Array<Record<string, JSONValue>>; restore: () => void } {
  const original = globalThis.fetch;
  const sent: Array<Record<string, JSONValue>> = [];
  let index = 0;
  globalThis.fetch = (_input: string | Request | URL, init?: RequestInit) => {
    sent.push(JSON.parse((init?.body as string) ?? "{}"));
    return Promise.resolve(
      new Response(JSON.stringify(bodies[index++]), { status: 200, headers: { "Content-Type": "application/json" } }),
    );
  };
  return { sent, restore: () => void (globalThis.fetch = original) };
}

const OR_ROUND_CALLS = [
  {
    toolUseId: "call_a",
    index: 0,
    toolName: "read_file",
    toolInput: { path: "a.ts" },
    toolResultContent: "BODY-a",
    toolResultIsError: false,
  },
  {
    toolUseId: "call_b",
    index: 1,
    toolName: "read_file",
    toolInput: { path: "b.ts" },
    toolResultContent: "BODY-b",
    toolResultIsError: false,
  },
];

Deno.test("OpenRouter's response carrier keeps reasoning details and every tool call as the model sent them", async () => {
  const scripted = scriptOpenRouterFetch([openRouterTwoCallResponse()]);
  try {
    const result = await new OpenRouterProvider({ apiKey: "test-key" }).generate("Plan.", { tools: [OR_READ_TOOL] });
    assertEquals(result.nativeAssistantReplay, {
      provider: "openrouter",
      assistantContent: "I will read both files.",
      reasoningContent: "Read both first.",
      reasoningDetails: OR_REASONING_DETAILS,
      toolCalls: OR_TOOL_CALLS,
    });
  } finally {
    scripted.restore();
  }
});

Deno.test("OpenRouter replays a priorRound after the prompt with reasoning details unchanged and in order", async () => {
  const scripted = scriptOpenRouterFetch([openRouterTwoCallResponse(), openRouterTwoCallResponse()]);
  try {
    const provider = new OpenRouterProvider({ apiKey: "test-key" });
    const first = await provider.generate("Plan.", { tools: [OR_READ_TOOL] });
    await provider.generate("Plan.", {
      tools: [OR_READ_TOOL],
      priorRound: { calls: OR_ROUND_CALLS, assistant: first.nativeAssistantReplay! },
    });
    const messages = scripted.sent[1].messages as Array<Record<string, JSONValue>>;
    assertEquals(messages[0], { role: "user", content: "Plan." });
    assertEquals(messages[1], {
      role: "assistant",
      content: "I will read both files.",
      reasoning_details: OR_REASONING_DETAILS,
      tool_calls: OR_TOOL_CALLS,
    });
    assertEquals(messages.slice(2).map((message) => message.tool_call_id), ["call_a", "call_b"]);
  } finally {
    scripted.restore();
  }
});

Deno.test("OpenRouter measureInputTokens counts the replayed round exactly as the request dispatches it", async () => {
  const scripted = scriptOpenRouterFetch([openRouterTwoCallResponse(), openRouterTwoCallResponse()]);
  try {
    const provider = new OpenRouterProvider({
      apiKey: "test-key",
      tokenizer: {
        countTokens: (text: string) => Promise.resolve(text.length),
        countTokensBatch: (texts: string[]) => Promise.resolve(texts.map((text) => text.length)),
      },
    });
    const options = {
      tools: [OR_READ_TOOL],
      priorRound: {
        calls: OR_ROUND_CALLS,
        assistant: {
          provider: "openrouter" as const,
          assistantContent: "I will read both files.",
          reasoningContent: "Read both first.",
          reasoningDetails: OR_REASONING_DETAILS,
          toolCalls: OR_TOOL_CALLS,
        },
      },
    };
    await provider.generate("Plan.", options);
    const dispatched = scripted.sent[0].messages as unknown[];
    const measured = await provider.measureInputTokens("Plan.", options);
    assertEquals(measured.sections.loopHistory, JSON.stringify(dispatched.slice(1)).length);
  } finally {
    scripted.restore();
  }
});

const ONE_TOOL: IModelOptions["tools"] = [{
  name: "read_file",
  description: "Read one file",
  inputSchema: { type: "object" },
}];

Deno.test("[openrouter policy] an off hint with tools sends the top-level parallel_tool_calls false", async () => {
  const body = await capturedBodyOf({
    tools: ONE_TOOL,
    toolChoice: { type: "auto", disable_parallel_tool_use: true },
  });
  assertEquals(body.parallel_tool_calls, false);
});

Deno.test("[openrouter policy] auto sends no parallel_tool_calls field, so the API default applies", async () => {
  const body = await capturedBodyOf({ tools: ONE_TOOL, toolChoice: { type: "auto" } });
  assertEquals(body.parallel_tool_calls, undefined);
});
