/**
 * @module OpenAiResponsesRequestTest
 * @path packages/ai/tests/openai_responses_request_test.ts
 * @description The /v1/responses request body for OpenAI reasoning models that call tools. Covers the wire shape,
 *   the tool-choice and parallel-call mapping, the replay of each completed round from its output items, and the
 *   extractors that read calls, text and usage from a Responses reply.
 * @architectural-layer Tests
 * @related-files [
 *   "packages/ai/src/provider_common_utils.ts",
 *   "packages/ai-openai/src/openai_provider.ts"
 * ]
 */

import { assertEquals, assertThrows } from "@std/assert";
import {
  createOpenAIResponsesRequestInit,
  extractResponsesAssistantReplay,
  extractResponsesContent,
  extractResponsesToolCalls,
  type IResponsesResponse,
  tokenMapperResponses,
} from "../src/openai_responses_wire.ts";
import type { IModelOptions, IProviderToolRound } from "../src/types.ts";
import type { JSONObject } from "../src/types.ts";
import type { JSONValue } from "@exaix/core";

const REASONING_MODEL = "gpt-6-sol";
const PLAIN_MODEL = "gpt-4o-mini";
const WRITE_TOOL = { name: "write_file", description: "Write a file", inputSchema: { type: "object" } };

/** The reasoning item and the function call of one Responses reply, as the API returns them. */
const REASONING_ITEM: JSONObject = { type: "reasoning", id: "rs_1", summary: [], encrypted_content: "ENC" };
const CALL_ITEM: JSONObject = {
  type: "function_call",
  id: "fc_1",
  call_id: "call_1",
  name: "write_file",
  arguments: '{"path":"a.txt"}',
  status: "completed",
};
const MESSAGE_ITEM: JSONObject = {
  type: "message",
  id: "msg_1",
  role: "assistant",
  status: "completed",
  content: [{ type: "output_text", text: "Writing the file.", annotations: [] }],
};

/** One completed round whose assistant part is the Responses output, replayed verbatim. */
function responsesRound(): IProviderToolRound {
  return {
    calls: [{
      toolUseId: "call_1",
      index: 0,
      toolName: "write_file",
      toolInput: { path: "a.txt" },
      toolResultContent: "written",
      toolResultIsError: false,
    }],
    assistant: {
      provider: "openai",
      assistantContent: "Writing the file.",
      toolCalls: [{ id: "call_1", type: "function", function: { name: "write_file", arguments: '{"path":"a.txt"}' } }],
      responseItems: [REASONING_ITEM, CALL_ITEM],
    },
  };
}

function bodyOf(prompt: string, options?: IModelOptions, model = REASONING_MODEL): JSONObject {
  const init = createOpenAIResponsesRequestInit("test-key", model, prompt, options);
  return JSON.parse(init.body as string);
}

Deno.test("createOpenAIResponsesRequestInit sends the prompt as input and tools as flat function definitions", () => {
  const body = bodyOf("test prompt", { tools: [WRITE_TOOL], effort: "high", max_tokens: 900 });
  assertEquals(body.model, REASONING_MODEL);
  assertEquals(body.input, [{ role: "user", content: "test prompt" }]);
  assertEquals(body.tools, [{
    type: "function",
    name: "write_file",
    description: "Write a file",
    parameters: { type: "object" },
    strict: false,
  }]);
  assertEquals(body.reasoning, { effort: "high" });
  assertEquals(body.max_output_tokens, 900);
  assertEquals(body.store, false);
  assertEquals(body.include, ["reasoning.encrypted_content"]);
  assertEquals(body.temperature, undefined);
  assertEquals(body.messages, undefined);
});

Deno.test("createOpenAIResponsesRequestInit clamps xhigh and max effort to high and omits reasoning without effort", () => {
  assertEquals(bodyOf("p", { tools: [WRITE_TOOL], effort: "xhigh" }).reasoning, { effort: "high" });
  assertEquals(bodyOf("p", { tools: [WRITE_TOOL], effort: "max" }).reasoning, { effort: "high" });
  assertEquals(bodyOf("p", { tools: [WRITE_TOOL] }).reasoning, undefined);
});

Deno.test("createOpenAIResponsesRequestInit maps tool choice and turns parallel calls off on disable_parallel_tool_use", () => {
  assertEquals(bodyOf("p", { tools: [WRITE_TOOL], toolChoice: { type: "auto" } }).tool_choice, "auto");
  assertEquals(bodyOf("p", { tools: [WRITE_TOOL], toolChoice: { type: "any" } }).tool_choice, "required");
  assertEquals(
    bodyOf("p", { tools: [WRITE_TOOL], toolChoice: { type: "tool", name: "write_file" } }).tool_choice,
    { type: "function", name: "write_file" },
  );
  assertEquals(bodyOf("p", { tools: [WRITE_TOOL], toolChoice: { type: "none" } }).tool_choice, "none");
  const serial = bodyOf("p", { tools: [WRITE_TOOL], toolChoice: { type: "auto", disable_parallel_tool_use: true } });
  assertEquals(serial.parallel_tool_calls, false);
});

Deno.test("createOpenAIResponsesRequestInit replays a completed round as its output items, then one function_call_output per call", () => {
  const body = bodyOf("test prompt", {
    tools: [WRITE_TOOL],
    nativeConversation: { initialPrompt: "test prompt", turns: [], rounds: [responsesRound()] },
  });
  assertEquals(body.input, [
    { role: "user", content: "test prompt" },
    REASONING_ITEM,
    CALL_ITEM,
    { type: "function_call_output", call_id: "call_1", output: "written" },
  ]);
});

Deno.test("createOpenAIResponsesRequestInit replays a priorRound after the prompt", () => {
  const body = bodyOf("test prompt", { tools: [WRITE_TOOL], priorRound: responsesRound() });
  assertEquals(body.input, [
    { role: "user", content: "test prompt" },
    REASONING_ITEM,
    CALL_ITEM,
    { type: "function_call_output", call_id: "call_1", output: "written" },
  ]);
});

Deno.test("createOpenAIResponsesRequestInit appends the round instruction as a user message", () => {
  const body = bodyOf("test prompt", {
    nativeConversation: {
      initialPrompt: "test prompt",
      turns: [],
      rounds: [responsesRound()],
      roundInstruction: "Answer now in text only.",
    },
  });
  const input = body.input as JSONValue[];
  assertEquals(input[input.length - 1], { role: "user", content: "Answer now in text only." });
});

Deno.test("createOpenAIResponsesRequestInit refuses a round that did not come from the Responses API", () => {
  const chatRound: IProviderToolRound = {
    ...responsesRound(),
    assistant: { provider: "openai", assistantContent: null, toolCalls: [CALL_ITEM] },
  };
  assertThrows(
    () => bodyOf("test prompt", { tools: [WRITE_TOOL], priorRound: chatRound }),
    Error,
    "can only replay a round from the Responses API",
  );
});

Deno.test("createOpenAIResponsesRequestInit replays a priorTurn with its own reasoning and call, dropping the other calls of its reply", () => {
  const OTHER_CALL: JSONObject = { ...CALL_ITEM, id: "fc_2", call_id: "call_2" };
  const body = bodyOf("test prompt", {
    tools: [WRITE_TOOL],
    priorTurn: {
      toolUseId: "call_1",
      toolName: "write_file",
      toolInput: { path: "a.txt" },
      toolResultContent: "written",
      toolResultIsError: false,
      responseItems: [REASONING_ITEM, CALL_ITEM, OTHER_CALL],
    },
  });
  assertEquals(body.input, [
    { role: "user", content: "test prompt" },
    REASONING_ITEM,
    CALL_ITEM,
    { type: "function_call_output", call_id: "call_1", output: "written" },
  ]);
});

Deno.test("createOpenAIResponsesRequestInit refuses a priorTurn that did not come from the Responses API", () => {
  assertThrows(
    () =>
      bodyOf("p", {
        tools: [WRITE_TOOL],
        priorTurn: {
          toolUseId: "call_1",
          toolName: "write_file",
          toolInput: {},
          toolResultContent: "ok",
          toolResultIsError: false,
        },
      }),
    Error,
    "can only replay a turn from the Responses API",
  );
});

Deno.test("createOpenAIResponsesRequestInit replays snapshot turns in order, each as its own call and output", () => {
  const body = bodyOf("p", {
    tools: [WRITE_TOOL],
    nativeConversation: {
      initialPrompt: "p",
      turns: [{
        toolUseId: "call_1",
        toolName: "write_file",
        toolInput: { path: "a.txt" },
        toolResultContent: "written",
        toolResultIsError: false,
        responseItems: [REASONING_ITEM, CALL_ITEM],
      }],
      roundInstruction: "Continue.",
    },
  });
  assertEquals(body.input, [
    { role: "user", content: "p" },
    REASONING_ITEM,
    CALL_ITEM,
    { type: "function_call_output", call_id: "call_1", output: "written" },
    { role: "user", content: "Continue." },
  ]);
});

Deno.test("createOpenAIResponsesRequestInit refuses a snapshot turn that did not come from the Responses API", () => {
  assertThrows(
    () =>
      bodyOf("p", {
        tools: [WRITE_TOOL],
        nativeConversation: {
          initialPrompt: "p",
          turns: [{
            toolUseId: "call_1",
            toolName: "write_file",
            toolInput: {},
            toolResultContent: "ok",
            toolResultIsError: false,
          }],
        },
      }),
    Error,
    "can only replay a turn from the Responses API",
  );
});

Deno.test("createOpenAIResponsesRequestInit sends temperature and top_p to plain models, and reasoning effort to reasoning models", () => {
  const plain = bodyOf("p", { temperature: 0.2, top_p: 0.9, effort: "high" }, PLAIN_MODEL);
  assertEquals(plain.temperature, 0.2);
  assertEquals(plain.top_p, 0.9);
  assertEquals(plain.reasoning, undefined);
  const reasoning = bodyOf("p", { temperature: 0.2, top_p: 0.9, effort: "high" }, REASONING_MODEL);
  assertEquals(reasoning.temperature, undefined);
  assertEquals(reasoning.top_p, undefined);
  assertEquals(reasoning.reasoning, { effort: "high" });
});

const RESPONSE_WITH_CALLS: IResponsesResponse = {
  model: REASONING_MODEL,
  status: "completed",
  output: [REASONING_ITEM, MESSAGE_ITEM, CALL_ITEM, {
    type: "function_call",
    id: "fc_2",
    call_id: "call_2",
    name: "write_file",
    arguments: '{"path":"b.txt"}',
    status: "completed",
  }],
  usage: {
    input_tokens: 120,
    output_tokens: 40,
    total_tokens: 160,
    output_tokens_details: { reasoning_tokens: 25 },
  },
};

Deno.test("extractResponsesToolCalls reads every function_call item with its call_id and parsed arguments", () => {
  assertEquals(extractResponsesToolCalls(RESPONSE_WITH_CALLS), [
    {
      id: "call_1",
      name: "write_file",
      input: { path: "a.txt" },
      type: "function",
      responseItems: RESPONSE_WITH_CALLS.output,
    },
    {
      id: "call_2",
      name: "write_file",
      input: { path: "b.txt" },
      type: "function",
      responseItems: RESPONSE_WITH_CALLS.output,
    },
  ]);
});

Deno.test("extractResponsesToolCalls drops a call whose arguments are malformed and keeps the rest", () => {
  const response: IResponsesResponse = {
    output: [{ ...CALL_ITEM, arguments: "{not json" }, { ...CALL_ITEM, call_id: "call_3" }],
  };
  const calls = extractResponsesToolCalls(response);
  assertEquals(calls?.map((call) => call.id), ["call_3"]);
});

Deno.test("extractResponsesToolCalls returns undefined when the reply has no calls", () => {
  assertEquals(extractResponsesToolCalls({ output: [MESSAGE_ITEM] }), undefined);
});

Deno.test("extractResponsesContent joins the output_text parts of the message items", () => {
  assertEquals(extractResponsesContent(RESPONSE_WITH_CALLS), "Writing the file.");
  assertEquals(extractResponsesContent({ output: [REASONING_ITEM] }), "");
});

Deno.test("extractResponsesAssistantReplay keeps the output items verbatim beside a chat-shaped call list", () => {
  assertEquals(extractResponsesAssistantReplay(RESPONSE_WITH_CALLS), {
    provider: "openai",
    assistantContent: "Writing the file.",
    toolCalls: [
      { id: "call_1", type: "function", function: { name: "write_file", arguments: '{"path":"a.txt"}' } },
      { id: "call_2", type: "function", function: { name: "write_file", arguments: '{"path":"b.txt"}' } },
    ],
    responseItems: RESPONSE_WITH_CALLS.output,
  });
  assertEquals(extractResponsesAssistantReplay({ output: [MESSAGE_ITEM] }), undefined);
});

Deno.test("tokenMapperResponses maps input and output tokens and the reasoning share", () => {
  const map = tokenMapperResponses(REASONING_MODEL)(RESPONSE_WITH_CALLS);
  assertEquals(map?.prompt_tokens, 120);
  assertEquals(map?.completion_tokens, 40);
  assertEquals(map?.total_tokens, 160);
  assertEquals(map?.reasoning_tokens, 25);
  assertEquals(map?.model, REASONING_MODEL);
  assertEquals(tokenMapperResponses(REASONING_MODEL)({ output: [] }), undefined);
});
