/**
 * @module AnthropicPriorTurnThinkingReplayTest
 * @path packages/ai-anthropic/tests/anthropic_prior_turn_thinking_replay_test.ts
 * @related-files [packages/ai-anthropic/src/anthropic_provider.ts]
 * @architectural-layer AI
 * @description GAP-153-F — verifies AnthropicProvider re-emits the prior turn's thinking
 * blocks (with their signatures) verbatim ahead of the tool_use block in the replayed
 * assistant message, matching Anthropic's requirement that thinking blocks be passed back
 * complete and unmodified in a tool-use turn (missing block -> HTTP 400).
 */

import { assertEquals, assertExists } from "@std/assert";
import { AnthropicProvider } from "../mod.ts";
import type { JSONValue } from "@exaix/core";
import type { IModelOptions } from "@exaix/ai/types.ts";

interface CapturedContentEntry {
  type: string;
  thinking?: string;
  signature?: string;
  id?: string;
  name?: string;
  input?: Record<string, JSONValue>;
}

interface CapturedMessage {
  role: string;
  content: CapturedContentEntry[];
}

interface CapturedBody {
  messages?: CapturedMessage[];
}

async function capturedBodyOf(options: IModelOptions): Promise<CapturedBody> {
  const provider = new AnthropicProvider({ apiKey: "test-key", model: "claude-sonnet-5" });

  const origFetch = globalThis.fetch;
  let capturedBody: CapturedBody = {};
  try {
    globalThis.fetch = (_input: string | Request | URL, init?: RequestInit) => {
      capturedBody = JSON.parse((init?.body as string) ?? "{}") as CapturedBody;
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

    await provider.generate("Fix the bug", options);
    return capturedBody;
  } finally {
    globalThis.fetch = origFetch;
  }
}

const priorTurnBase = {
  toolUseId: "call_1",
  toolName: "write_file",
  toolInput: { path: "test.txt" },
  toolResultContent: "done",
  toolResultIsError: false,
};

Deno.test("AnthropicProvider replays prior thinking block + signature ahead of tool_use (GAP-153-F)", async () => {
  const body = await capturedBodyOf({
    tools: [{ name: "write_file", description: "Write", inputSchema: { type: "object" } }],
    priorTurn: {
      ...priorTurnBase,
      thinkingBlocks: [{ thinking: "I need to write the file.", signature: "sig-think-1" }],
    },
  });

  assertExists(body.messages);
  assertEquals(body.messages.length, 3);
  assertEquals(body.messages[0].role, "assistant");
  assertExists(body.messages[0].content);
  assertEquals(body.messages[0].content[0].type, "thinking");
  assertEquals(body.messages[0].content[0].thinking, "I need to write the file.");
  assertEquals(body.messages[0].content[0].signature, "sig-think-1");
  assertEquals(body.messages[0].content[1].type, "tool_use");
});

Deno.test("AnthropicProvider omits thinking block when priorTurn carries none (unchanged)", async () => {
  const body = await capturedBodyOf({
    tools: [{ name: "write_file", description: "Write", inputSchema: { type: "object" } }],
    priorTurn: priorTurnBase,
  });

  assertExists(body.messages);
  assertEquals(body.messages[0].content.length, 1);
  assertEquals(body.messages[0].content[0].type, "tool_use");
  assertEquals(body.messages[0].content[0].id, "call_1");
});
