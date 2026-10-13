/**
 * @module OpenAiResponsesProviderTest
 * @path packages/ai-openai/tests/openai_responses_provider_test.ts
 * @description OpenAIProvider on /v1/responses for reasoning models that call tools. Each test captures the HTTP
 *   requests with a fetch stub and checks the endpoint, the body, the replayed round, the routing to Chat Completions
 *   for other calls, the refusal of a failed reply, and the exact input measurement.
 * @architectural-layer Tests
 * @related-files [
 *   "packages/ai-openai/src/openai_provider.ts",
 *   "packages/ai/src/openai_responses_wire.ts",
 *   "packages/ai-openai/tests/openai_provider_tools_request_test.ts"
 * ]
 */

import { assert, assertEquals, assertRejects } from "@std/assert";
import { OpenAIProvider } from "../src/openai_provider.ts";
import { createOpenAIResponsesRequestInit } from "@exaix/ai/openai_responses_wire.ts";
import { ProviderTruncationError } from "@exaix/ai/providers";
import type { IModelOptions, IProviderToolResultEntry, JSONObject } from "@exaix/ai/types.ts";
import type { JSONValue } from "@exaix/core";
import { PromptBudgetSection } from "@exaix/schemas/prompt_budget.ts";

const REASONING_MODEL = "gpt-6-sol";
const CHAT_MODEL = "gpt-4o-mini";
const RESPONSES_URL = "https://api.openai.com/v1/responses";
const READ_TOOL = { name: "read_file", description: "Read a file", inputSchema: { type: "object" } };

const REASONING_ITEM = { type: "reasoning", id: "rs_1", summary: [], encrypted_content: "ENC" };
const CALL_A = {
  type: "function_call",
  id: "fc_a",
  call_id: "call_a",
  name: "read_file",
  arguments: '{"path":"a.ts"}',
  status: "completed",
};
const CALL_B = {
  type: "function_call",
  id: "fc_b",
  call_id: "call_b",
  name: "read_file",
  arguments: '{"path":"b.ts"}',
  status: "completed",
};

/** A reply that carries reasoning and two calls, as the Responses API returns it. */
const TOOL_ROUND_REPLY = {
  model: REASONING_MODEL,
  status: "completed",
  output: [REASONING_ITEM, CALL_A, CALL_B],
  usage: { input_tokens: 50, output_tokens: 20, total_tokens: 70, output_tokens_details: { reasoning_tokens: 12 } },
};

const FINAL_REPLY = {
  model: REASONING_MODEL,
  status: "completed",
  output: [{
    type: "message",
    id: "msg_final",
    role: "assistant",
    status: "completed",
    content: [{ type: "output_text", text: "Both files read.", annotations: [] }],
  }],
  usage: { input_tokens: 90, output_tokens: 8, total_tokens: 98 },
};

interface ICapturedRequest {
  url: string;
  body: JSONObject;
}

/** Answers each request with the next reply, and records the URL and body of every request. */
function scriptFetch(replies: JSONObject[]): { sent: ICapturedRequest[]; restore: () => void } {
  const sent: ICapturedRequest[] = [];
  const original = globalThis.fetch;
  let index = 0;
  globalThis.fetch = (input: string | Request | URL, init?: RequestInit) => {
    sent.push({ url: String(input), body: JSON.parse((init?.body as string) ?? "{}") });
    const reply = replies[Math.min(index++, replies.length - 1)];
    return Promise.resolve(
      new Response(JSON.stringify(reply), { status: 200, headers: { "Content-Type": "application/json" } }),
    );
  };
  return { sent, restore: () => void (globalThis.fetch = original) };
}

/** A tokenizer that counts characters, so the measurement is the exact length of the replayed text. */
const CHARACTER_TOKENIZER = {
  countTokens: (text: string) => Promise.resolve(text.length),
  countTokensBatch: (texts: string[]) => Promise.resolve(texts.map((text) => text.length)),
};

function resultFor(toolUseId: string, content: string): IProviderToolResultEntry {
  return {
    toolUseId,
    index: 0,
    toolName: "read_file",
    toolInput: {},
    toolResultContent: content,
    toolResultIsError: false,
  };
}

Deno.test("OpenAIProvider rejects an empty incomplete Responses reply once with the shared truncation class", async () => {
  const scripted = scriptFetch([{
    status: "incomplete",
    incomplete_details: { reason: "max_output_tokens" },
    output: [REASONING_ITEM],
  }]);
  try {
    const provider = new OpenAIProvider({ apiKey: "fixture-key", model: REASONING_MODEL, maxRetries: 3 });
    const error = await assertRejects(
      () => provider.generate("Read the file.", { tools: [READ_TOOL], max_tokens: 1000 }),
      ProviderTruncationError,
    );
    assertEquals(error.provider, provider.id);
    assertEquals(scripted.sent.length, 1);
    assertEquals(scripted.sent[0].url, RESPONSES_URL);
    assertEquals(error.message.includes("incomplete_details.reason=max_output_tokens"), true);
  } finally {
    scripted.restore();
  }
});

Deno.test("OpenAIProvider preserves incomplete text and function-call output instead of throwing truncation", async () => {
  const scripted = scriptFetch([
    { ...FINAL_REPLY, status: "incomplete", incomplete_details: { reason: "max_output_tokens" } },
    { ...TOOL_ROUND_REPLY, status: "incomplete", incomplete_details: { reason: "max_output_tokens" } },
  ]);
  try {
    const provider = new OpenAIProvider({ apiKey: "fixture-key", model: REASONING_MODEL });
    const text = await provider.generate("Summarize.");
    assertEquals(text.content, "Both files read.");
    const calls = await provider.generate("Read both files.", { tools: [READ_TOOL] });
    assertEquals(calls.toolCalls?.map((call) => call.id), ["call_a", "call_b"]);
    assert(calls.nativeAssistantReplay?.provider === "openai");
    assertEquals(calls.nativeAssistantReplay.responseItems, TOOL_ROUND_REPLY.output);
    assertEquals(scripted.sent.length, 2);
  } finally {
    scripted.restore();
  }
});

Deno.test("an OpenAI reasoning model with tools calls /v1/responses and keeps every output item for replay", async () => {
  const scripted = scriptFetch([TOOL_ROUND_REPLY]);
  try {
    const provider = new OpenAIProvider({ apiKey: "test-key", model: REASONING_MODEL });
    const result = await provider.generate("Read both files.", { tools: [READ_TOOL], effort: "high" });
    assertEquals(scripted.sent[0].url, RESPONSES_URL);
    assertEquals(scripted.sent[0].body.reasoning, { effort: "high" });
    assertEquals(scripted.sent[0].body.store, false);
    assertEquals(result.toolCalls?.map((call) => call.id), ["call_a", "call_b"]);
    assertEquals(result.nativeAssistantReplay, {
      provider: "openai",
      assistantContent: null,
      toolCalls: [
        { id: "call_a", type: "function", function: { name: "read_file", arguments: '{"path":"a.ts"}' } },
        { id: "call_b", type: "function", function: { name: "read_file", arguments: '{"path":"b.ts"}' } },
      ],
      responseItems: TOOL_ROUND_REPLY.output,
    });
    assertEquals(result.usage.reasoningTokens, 12);
  } finally {
    scripted.restore();
  }
});

Deno.test("the next Responses request replays the round's output items verbatim, then one output per call", async () => {
  const scripted = scriptFetch([TOOL_ROUND_REPLY, FINAL_REPLY]);
  try {
    const provider = new OpenAIProvider({ apiKey: "test-key", model: REASONING_MODEL });
    const first = await provider.generate("Read both files.", { tools: [READ_TOOL] });
    await provider.generate("Read both files.", {
      tools: [READ_TOOL],
      priorRound: {
        calls: [resultFor("call_a", "BODY-a"), resultFor("call_b", "BODY-b")],
        assistant: first.nativeAssistantReplay!,
      },
    });
    assertEquals(scripted.sent[1].body.input, [
      { role: "user", content: "Read both files." },
      REASONING_ITEM,
      CALL_A,
      CALL_B,
      { type: "function_call_output", call_id: "call_a", output: "BODY-a" },
      { type: "function_call_output", call_id: "call_b", output: "BODY-b" },
    ]);
  } finally {
    scripted.restore();
  }
});

Deno.test("every native OpenAI call uses /v1/responses, including plain-text and non-reasoning models", async () => {
  const scripted = scriptFetch([FINAL_REPLY, FINAL_REPLY]);
  try {
    await new OpenAIProvider({ apiKey: "test-key", model: CHAT_MODEL }).generate("Read it.", { tools: [READ_TOOL] });
    await new OpenAIProvider({ apiKey: "test-key", model: REASONING_MODEL }).generate("Think.");
    assertEquals(scripted.sent.map((request) => request.url), [RESPONSES_URL, RESPONSES_URL]);
    assertEquals(scripted.sent[1].body.tools, undefined);
  } finally {
    scripted.restore();
  }
});

Deno.test("a Responses reply marked failed is refused, not read as an empty answer", async () => {
  const scripted = scriptFetch([{ status: "failed", error: { message: "server_error" }, output: [] }]);
  try {
    const provider = new OpenAIProvider({ apiKey: "test-key", model: REASONING_MODEL });
    await assertRejects(
      () => provider.generate("Read it.", { tools: [READ_TOOL] }),
      Error,
      "server_error",
    );
  } finally {
    scripted.restore();
  }
});

Deno.test("measureInputTokens counts the Responses history exactly as the request dispatches it", async () => {
  const scripted = scriptFetch([TOOL_ROUND_REPLY, FINAL_REPLY]);
  try {
    const provider = new OpenAIProvider({
      apiKey: "test-key",
      model: REASONING_MODEL,
      tokenizer: CHARACTER_TOKENIZER,
    });
    const first = await provider.generate("Read both files.", { tools: [READ_TOOL] });
    const options = {
      tools: [READ_TOOL],
      priorRound: {
        calls: [resultFor("call_a", "BODY-a"), resultFor("call_b", "BODY-b")],
        assistant: first.nativeAssistantReplay!,
      },
    };
    await provider.generate("Read both files.", options);
    const dispatched = scripted.sent[1].body.input as JSONValue[];
    const measured = await provider.measureInputTokens("Read both files.", options);
    assertEquals(measured.sections.loopHistory, JSON.stringify(dispatched.slice(1)).length);
  } finally {
    scripted.restore();
  }
});

Deno.test("native OpenAI calls send tools as flat Responses functions with the requested tool choice", async () => {
  const scripted = scriptFetch([FINAL_REPLY]);
  try {
    await new OpenAIProvider({ apiKey: "test-key", model: REASONING_MODEL }).generate("Read it.", {
      tools: [READ_TOOL],
      toolChoice: { type: "any" },
    });
    assertEquals(scripted.sent[0].body.tools, [{
      type: "function",
      name: "read_file",
      description: "Read a file",
      parameters: { type: "object" },
      strict: false,
    }]);
    assertEquals(scripted.sent[0].body.tool_choice, "required");
  } finally {
    scripted.restore();
  }
});

Deno.test("a plain native call sends input and no tools, and returns the reply text", async () => {
  const scripted = scriptFetch([FINAL_REPLY]);
  try {
    const result = await new OpenAIProvider({ apiKey: "test-key", model: REASONING_MODEL }).generate("Summarize.");
    assertEquals(scripted.sent[0].body.input, [{ role: "user", content: "Summarize." }]);
    assertEquals(scripted.sent[0].body.tools, undefined);
    assertEquals(result.content, "Both files read.");
  } finally {
    scripted.restore();
  }
});

Deno.test("a malformed argument string stays in the replay carrier and is absent from the executable toolCalls", async () => {
  const malformed = { ...CALL_A, arguments: "{not json" };
  const scripted = scriptFetch([{ ...TOOL_ROUND_REPLY, output: [REASONING_ITEM, malformed, CALL_B] }]);
  try {
    const result = await new OpenAIProvider({ apiKey: "test-key", model: REASONING_MODEL }).generate(
      "Read both files.",
      {
        tools: [READ_TOOL],
      },
    );
    assertEquals(result.toolCalls?.map((call) => call.id), ["call_b"], "the malformed call does not execute");
    assertEquals(result.nativeAssistantReplay, {
      provider: "openai",
      assistantContent: null,
      toolCalls: [
        { id: "call_a", type: "function", function: { name: "read_file", arguments: "{not json" } },
        { id: "call_b", type: "function", function: { name: "read_file", arguments: '{"path":"b.ts"}' } },
      ],
      responseItems: [REASONING_ITEM, malformed, CALL_B],
    }, "the carrier keeps every original call, verbatim");
  } finally {
    scripted.restore();
  }
});

Deno.test("measureInputTokens keeps the initial prompt sections and counts a large rich result in full", async () => {
  const provider = new OpenAIProvider({ apiKey: "test-key", model: REASONING_MODEL, tokenizer: CHARACTER_TOKENIZER });
  const richResult = [{ type: "text", text: "RICH-".repeat(800) }];
  const options: IModelOptions = {
    tools: [READ_TOOL],
    nativeConversation: {
      initialPrompt: "Plan the change.",
      initialPromptSections: [
        { section: PromptBudgetSection.SYSTEM, text: "SYSTEM-TEXT" },
        { section: PromptBudgetSection.PLAN, text: "PLAN-TEXT" },
      ],
      turns: [],
      rounds: [{
        calls: [{
          toolUseId: "call_a",
          index: 0,
          toolName: "read_file",
          toolInput: { path: "a.ts" },
          toolResultContent: richResult,
          toolResultIsError: false,
        }],
        assistant: {
          provider: "openai",
          assistantContent: null,
          toolCalls: [{
            id: "call_a",
            type: "function",
            function: { name: "read_file", arguments: '{"path":"a.ts"}' },
          }],
          responseItems: [REASONING_ITEM, CALL_A],
        },
      }],
    },
  };
  // The builder is the dispatch source: attemptGenerate sends exactly this projection.
  const dispatched = JSON.parse(
    createOpenAIResponsesRequestInit("", REASONING_MODEL, "Plan the change.", options).body as string,
  ).input as JSONValue[];
  const measured = await provider.measureInputTokens("Plan the change.", options);

  assertEquals(measured.sections.plan, "PLAN-TEXT".length, "the caller's plan section is counted as given");
  assertEquals(
    measured.sections.loopHistory,
    JSON.stringify(dispatched.slice(1)).length,
    "the rich result is counted in full",
  );
});
