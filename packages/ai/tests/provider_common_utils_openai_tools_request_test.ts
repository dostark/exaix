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

import { assertEquals, assertExists, assertThrows } from "@std/assert";
import { createOpenAIChatCompletionsRequestInit } from "../src/provider_common_utils.ts";
import type { IModelOptions, IProviderToolRound } from "../src/types.ts";
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
  parallel_tool_calls?: boolean;
  tool_choice?: "auto" | "none" | "required" | { type: "function"; function: { name: string } };
  max_completion_tokens?: number;
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  reasoning_effort?: string;
}

function capturedBodyOf(options?: IModelOptions, model = "gpt-5"): CapturedBody {
  const init = createOpenAIChatCompletionsRequestInit("test-key", model, "test prompt", options);
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

Deno.test("createOpenAIChatCompletionsRequestInit with priorTurn reasoningContent echoes it on the assistant message (GAP-153-G)", () => {
  const body = capturedBodyOf({
    priorTurn: {
      toolUseId: "call_3",
      toolName: "patch_file",
      toolInput: { path: "a.ts", diff: "..." },
      toolResultContent: "patched successfully",
      toolResultIsError: false,
      reasoningContent: "I need to apply the diff to a.ts.",
    },
  });

  assertEquals(body.messages.length, 3);
  assertEquals(body.messages[0].role, "assistant");
  assertEquals(body.messages[0].content, null);
  assertEquals(
    (body.messages[0] as CapturedOpenAiMessage & { reasoning_content?: string }).reasoning_content,
    "I need to apply the diff to a.ts.",
  );
});

Deno.test("createOpenAIChatCompletionsRequestInit with priorTurn lacking reasoningContent omits it on the assistant message", () => {
  const body = capturedBodyOf({
    priorTurn: {
      toolUseId: "call_4",
      toolName: "patch_file",
      toolInput: { path: "a.ts", diff: "..." },
      toolResultContent: "patched successfully",
      toolResultIsError: false,
    },
  });

  assertEquals(
    (body.messages[0] as CapturedOpenAiMessage & { reasoning_content?: string }).reasoning_content,
    undefined,
  );
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

Deno.test("compatible snapshot replays the immutable initial prompt and each completed turn once", () => {
  const options: IModelOptions = {
    nativeConversation: {
      initialPrompt: "role and portal context",
      roundInstruction: "Return the final answer",
      turns: [{
        toolUseId: "call_1",
        toolName: "read_file",
        toolInput: { path: "README.md" },
        toolResultContent: "file contents",
        toolResultIsError: false,
        assistantContent: "I will inspect the file.",
      }],
    },
  };
  const body = JSON.parse(
    createOpenAIChatCompletionsRequestInit("test-key", "gpt-4.1-mini", "role and portal context", options)
      .body as string,
  ) as CapturedBody;

  assertEquals(body.messages.map(({ role, content }) => [role, content]), [
    ["user", "role and portal context"],
    ["assistant", "I will inspect the file."],
    ["tool", "file contents"],
    ["user", "Return the final answer"],
  ]);
});

Deno.test(
  "createOpenAIChatCompletionsRequestInit serializes max_tokens as max_completion_tokens (OpenAI deprecated max_tokens; incompatible with o-series/gpt-5 reasoning models)",
  () => {
    const body = capturedBodyOf({ max_tokens: 8192 });
    assertEquals(body.max_completion_tokens, 8192);
    assertEquals(body.max_tokens, undefined);
  },
);

Deno.test(
  "createOpenAIChatCompletionsRequestInit omits temperature/top_p for reasoning models (o-series/gpt-5.x reject non-default values)",
  () => {
    const body = capturedBodyOf({ temperature: 0.1, top_p: 0.9 }, "gpt-5-mini");
    assertEquals(body.temperature, undefined);
    assertEquals(body.top_p, undefined);
  },
);

Deno.test(
  "createOpenAIChatCompletionsRequestInit keeps temperature/top_p for non-reasoning models (e.g. gpt-4o-mini)",
  () => {
    const body = capturedBodyOf({ temperature: 0.1, top_p: 0.9 }, "gpt-4o-mini");
    assertEquals(body.temperature, 0.1);
    assertEquals(body.top_p, 0.9);
  },
);

Deno.test(
  "createOpenAIChatCompletionsRequestInit forces reasoning_effort:none on reasoning models when tools are present (Chat Completions rejects function tools with any other reasoning_effort on gpt-5.6+)",
  () => {
    const body = capturedBodyOf({
      effort: "high",
      tools: [{ name: "write_file", description: "write", inputSchema: { type: "object" } }],
    }, "gpt-5.6-terra");
    assertEquals(body.reasoning_effort, "none");
  },
);

Deno.test(
  "createOpenAIChatCompletionsRequestInit treats the gpt-6 family as reasoning models: tools force reasoning_effort:none and temperature is omitted (gpt-6-luna rejects function tools at any other effort)",
  () => {
    const body = capturedBodyOf({
      effort: "high",
      temperature: 0.1,
      tools: [{ name: "write_file", description: "write", inputSchema: { type: "object" } }],
    }, "gpt-6-luna");
    assertEquals(body.reasoning_effort, "none");
    assertEquals(body.temperature, undefined);
  },
);

Deno.test(
  "createOpenAIChatCompletionsRequestInit passes options.effort through as reasoning_effort on reasoning models when no tools are present",
  () => {
    const body = capturedBodyOf({ effort: "high" }, "gpt-5.6-terra");
    assertEquals(body.reasoning_effort, "high");
  },
);

Deno.test(
  "createOpenAIChatCompletionsRequestInit omits reasoning_effort on reasoning models when no effort and no tools are given",
  () => {
    const body = capturedBodyOf({}, "gpt-5.6-terra");
    assertEquals(body.reasoning_effort, undefined);
  },
);

Deno.test(
  "createOpenAIChatCompletionsRequestInit never sends reasoning_effort for non-reasoning models, even with tools",
  () => {
    const body = capturedBodyOf({
      effort: "high",
      tools: [{ name: "write_file", description: "write", inputSchema: { type: "object" } }],
    }, "gpt-4o-mini");
    assertEquals(body.reasoning_effort, undefined);
  },
);

function authorizationOf(init: RequestInit): string | null {
  return new Headers(init.headers).get("Authorization");
}

Deno.test("[phase203.provider] the shared request builder omits Authorization only for an absent key", () => {
  assertEquals(authorizationOf(createOpenAIChatCompletionsRequestInit(undefined, "gpt-5", "prompt")), null);
  assertEquals(authorizationOf(createOpenAIChatCompletionsRequestInit("", "gpt-5", "prompt")), null);
  assertEquals(
    authorizationOf(createOpenAIChatCompletionsRequestInit("test-key", "gpt-5", "prompt")),
    "Bearer test-key",
  );
  assertEquals(
    new Headers(createOpenAIChatCompletionsRequestInit(undefined, "gpt-5", "prompt").headers).get("Content-Type"),
    "application/json",
  );
});

const OPENAI_ROUND_TOOL_CALLS = [
  { id: "call_a", type: "function", function: { name: "read_file", arguments: '{"path":"a.ts"}' } },
  { id: "call_b", type: "function", function: { name: "read_file", arguments: '{"path":"b.ts"}' } },
];

/** A completed OpenAI round: assistant text, reasoning, structured reasoning details, two calls. */
const OPENAI_ROUND: IProviderToolRound = {
  calls: [
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
  ],
  assistant: {
    provider: "openai",
    assistantContent: "I will read both files.",
    reasoningContent: "Read both first.",
    reasoningDetails: [{ type: "reasoning.text", text: "Read both first.", signature: "sig-r" }],
    toolCalls: OPENAI_ROUND_TOOL_CALLS,
  },
};

/** Parses the messages the OpenAI request builder sends for one generate call. */
function sentMessages(options: IModelOptions): Array<Record<string, JSONValue>> {
  const init = createOpenAIChatCompletionsRequestInit("", "gpt-test", "Plan the change.", options);
  return (JSON.parse(init.body as string) as { messages: Array<Record<string, JSONValue>> }).messages;
}

Deno.test("a priorRound replays one assistant tool_calls array verbatim, then one tool message per id", () => {
  assertEquals(sentMessages({ priorRound: OPENAI_ROUND }), [
    { role: "user", content: "Plan the change." },
    {
      role: "assistant",
      content: "I will read both files.",
      reasoning_content: "Read both first.",
      reasoning_details: [{ type: "reasoning.text", text: "Read both first.", signature: "sig-r" }],
      tool_calls: OPENAI_ROUND_TOOL_CALLS,
    },
    { role: "tool", tool_call_id: "call_a", content: "BODY-a" },
    { role: "tool", tool_call_id: "call_b", content: "BODY-b" },
  ]);
});

Deno.test("a snapshot carrying rounds projects each round once, after its initial prompt, before the control text", () => {
  const messages = sentMessages({
    nativeConversation: {
      initialPrompt: "Plan the change.",
      turns: [],
      rounds: [OPENAI_ROUND],
      roundInstruction: "Answer now.",
    },
  });
  assertEquals(messages.map((message) => message.role), ["user", "assistant", "tool", "tool", "user"]);
  assertEquals(messages[4], { role: "user", content: "Answer now." });
});

Deno.test("a snapshot refuses rounds together with legacy turns instead of duplicating the exchange", () => {
  assertThrows(() =>
    sentMessages({
      nativeConversation: {
        initialPrompt: "Plan the change.",
        turns: [{
          toolUseId: "call_x",
          toolName: "read_file",
          toolInput: { path: "x.ts" },
          toolResultContent: "X",
          toolResultIsError: false,
        }],
        rounds: [OPENAI_ROUND],
      },
    })
  );
});

Deno.test("a priorRound refuses another provider's replay carrier", () => {
  const anthropicRound: IProviderToolRound = {
    ...OPENAI_ROUND,
    assistant: { provider: "anthropic", blocks: [] },
  };
  assertThrows(() => sentMessages({ priorRound: anthropicRound }));
});

const ONE_TOOL = [{ name: "read_file", description: "Read one file", inputSchema: { type: "object" } }];

Deno.test("[openai policy] an off hint with tools sends the top-level parallel_tool_calls false", () => {
  const body = capturedBodyOf({
    tools: ONE_TOOL,
    toolChoice: { type: "auto", disable_parallel_tool_use: true },
  });
  assertEquals(body.parallel_tool_calls, false);
});

Deno.test("[openai policy] auto sends no parallel_tool_calls field, so the API default applies", () => {
  const body = capturedBodyOf({ tools: ONE_TOOL, toolChoice: { type: "auto" } });
  assertEquals(body.parallel_tool_calls, undefined);
});
