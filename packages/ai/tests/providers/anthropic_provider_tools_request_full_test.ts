/**
 * @module AnthropicProviderToolsRequestFullTest
 * @path packages/ai/tests/providers/anthropic_provider_tools_request_full_test.ts
 * @description Tests that AnthropicProvider.attemptGenerate() serializes ALL IToolDefinition
 * fields (strict, cache_control, input_examples, type) into the real request body.
 */

import { assertEquals, assertExists } from "@std/assert";
import { AnthropicProvider } from "@exaix/ai-anthropic";
import type { IModelOptions, IProviderToolRound, JSONObject } from "@exaix/ai/types.ts";
import { NATIVE_NO_TOOLS_TEXT_INSTRUCTION } from "@exaix/ai/provider_common_utils.ts";

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

const READ_TOOL = {
  name: "read_file",
  inputSchema: { type: "object", properties: { path: { type: "string" } } },
};

/** The complete assistant content of one response: thinking, redacted thinking, text and two calls. */
const ROUND_BLOCKS = [
  { type: "thinking", thinking: "Read both files first.", signature: "sig-thinking" },
  { type: "redacted_thinking", data: "opaque-redacted" },
  { type: "text", text: "I will read both files." },
  { type: "tool_use", id: "toolu_a", name: "read_file", input: { path: "a.ts" } },
  { type: "tool_use", id: "toolu_b", name: "read_file", input: { path: "b.ts" } },
];

const TWO_CALL_ROUND: IProviderToolRound = {
  calls: [
    {
      toolUseId: "toolu_a",
      index: 0,
      toolName: "read_file",
      toolInput: { path: "a.ts" },
      toolResultContent: "BODY-a",
      toolResultIsError: false,
    },
    {
      toolUseId: "toolu_b",
      index: 1,
      toolName: "read_file",
      toolInput: { path: "b.ts" },
      toolResultContent: "refused",
      toolResultIsError: true,
    },
  ],
  assistant: { provider: "anthropic", blocks: ROUND_BLOCKS },
};

interface CapturedMessage {
  role: string;
  content: string | JSONObject[];
}

interface CapturedRoundBody extends CapturedBody {
  messages: CapturedMessage[];
}

/** Captures the body that attemptGenerate sends for one generate call with a priorRound. */
async function captureRoundBody(
  options: IModelOptions & { priorRound: IProviderToolRound },
): Promise<CapturedRoundBody> {
  const provider = new AnthropicProvider({ apiKey: "test-key" });
  const origFetch = globalThis.fetch;
  let body: CapturedRoundBody = { messages: [] };
  try {
    globalThis.fetch = (_input: string | Request | URL, init?: RequestInit) => {
      body = JSON.parse((init?.body as string) ?? "{}");
      return Promise.resolve(
        new Response(
          JSON.stringify({ content: [{ type: "text", text: "ok" }], usage: { input_tokens: 1, output_tokens: 1 } }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    };
    await provider.generate("Plan the change.", options);
    return body;
  } finally {
    globalThis.fetch = origFetch;
  }
}

Deno.test("a priorRound replays the full assistant blocks once, then one user message of every result", async () => {
  const body = await captureRoundBody({ tools: [READ_TOOL], priorRound: TWO_CALL_ROUND });

  assertEquals(body.messages.length, 3);
  assertEquals(body.messages[0], {
    role: "user",
    content: [{ type: "text", text: "Plan the change.", cache_control: { type: "ephemeral" } }],
  });
  assertEquals(body.messages[1], { role: "assistant", content: ROUND_BLOCKS });
  assertEquals(body.messages[2], {
    role: "user",
    content: [
      { type: "tool_result", tool_use_id: "toolu_a", content: "BODY-a", is_error: false },
      { type: "tool_result", tool_use_id: "toolu_b", content: "refused", is_error: true },
    ],
  });
});

Deno.test("a NONE priorRound places the control text after every result, never before them", async () => {
  const body = await captureRoundBody({
    tools: [READ_TOOL],
    toolChoice: { type: "none" },
    priorRound: TWO_CALL_ROUND,
  });

  assertEquals(body.messages[2].content, [
    { type: "tool_result", tool_use_id: "toolu_a", content: "BODY-a", is_error: false },
    { type: "tool_result", tool_use_id: "toolu_b", content: "refused", is_error: true },
    { type: "text", text: NATIVE_NO_TOOLS_TEXT_INSTRUCTION },
  ]);
});

Deno.test("a one-call priorRound keeps the original policy and the single result adjacent to its call", async () => {
  const oneCall: IProviderToolRound = {
    calls: [TWO_CALL_ROUND.calls[0]],
    assistant: { provider: "anthropic", blocks: ROUND_BLOCKS.slice(0, 4) },
  };
  const body = await captureRoundBody({
    tools: [READ_TOOL],
    toolChoice: { type: "auto", disable_parallel_tool_use: true },
    priorRound: oneCall,
  });

  assertEquals(body.tool_choice, { type: "auto", disable_parallel_tool_use: true });
  assertEquals(body.messages[1], { role: "assistant", content: ROUND_BLOCKS.slice(0, 4) });
  assertEquals(body.messages[2], {
    role: "user",
    content: [{ type: "tool_result", tool_use_id: "toolu_a", content: "BODY-a", is_error: false }],
  });
});
