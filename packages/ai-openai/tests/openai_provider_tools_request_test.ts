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

import { assert, assertEquals, assertExists } from "@std/assert";
import { OpenAIProvider } from "../src/openai_provider.ts";
import type { JSONValue } from "@exaix/core";
import { PromptBudgetSection } from "@exaix/schemas/prompt_budget.ts";
import { createOpenAIChatCompletionsRequestInit } from "@exaix/ai/provider_common_utils.ts";

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

const SELF_HOSTED_ENDPOINT = "https://gpu.internal/v1/chat/completions";

function selfHostedProvider(supportsToolChoice?: boolean): OpenAIProvider {
  return new OpenAIProvider({
    apiKey: "",
    model: "llama3.1:8b",
    compatible: {
      profile: "self-hosted",
      endpoint: SELF_HOSTED_ENDPOINT,
      model: "llama3.1:8b",
      allow_insecure_loopback: false,
      max_response_bytes: 4096,
      max_tool_argument_bytes: 512,
      max_history_bytes: 4096,
      ...(supportsToolChoice === undefined ? {} : { supports_tool_choice: supportsToolChoice }),
    },
  });
}

Deno.test("[phase203.provider] supportsToolChoice follows the self-hosted declaration and stays absent elsewhere", () => {
  assertEquals(selfHostedProvider().callCapabilities?.supportsToolChoice, false);
  assertEquals("supportsToolChoice" in selfHostedProvider().callCapabilities!, true);
  assertEquals("supportsToolChoice" in selfHostedProvider(true).callCapabilities!, false);
  for (const profile of ["openai", "deepseek", "local-test"] as const) {
    const provider = new OpenAIProvider({
      apiKey: "test-key",
      model: "compat-fixture-v1",
      compatible: {
        profile,
        endpoint: "http://127.0.0.1:4312/v1/chat/completions",
        allow_insecure_loopback: true,
        max_response_bytes: 4096,
        max_tool_argument_bytes: 512,
        max_history_bytes: 4096,
      },
    });
    assertEquals("supportsToolChoice" in provider.callCapabilities!, false, profile);
  }
});

// DeepSeek answered HTTP 400 "Thinking mode does not support this tool_choice" for a named
// tool and for "required" on 2026-10-05. Thinking with "auto" returned 200.
Deno.test("[provider] only the DeepSeek profile refuses a forced tool_choice while thinking", () => {
  for (const profile of ["openai", "deepseek", "local-test"] as const) {
    const provider = new OpenAIProvider({
      apiKey: "test-key",
      model: "compat-fixture-v1",
      compatible: {
        profile,
        endpoint: "http://127.0.0.1:4312/v1/chat/completions",
        allow_insecure_loopback: true,
        max_response_bytes: 4096,
        max_tool_argument_bytes: 512,
        max_history_bytes: 4096,
      },
    });
    assertEquals(
      provider.callCapabilities?.supportsForcedToolChoiceWithThinking,
      profile === "deepseek" ? false : undefined,
      profile,
    );
  }
});

const READ_TOOL = {
  name: "read_file",
  inputSchema: { type: "object", properties: { path: { type: "string" } } },
};

const ROUND_TOOL_CALLS = [
  { id: "call_a", type: "function", function: { name: "read_file", arguments: '{"path":"a.ts"}' } },
  { id: "call_b", type: "function", function: { name: "read_file", arguments: '{"path":"b.ts"}' } },
];

const ROUND_REASONING_DETAILS = [
  { type: "reasoning.text", text: "Read both first.", signature: "sig-r" },
  { type: "reasoning.summary", summary: "Two reads." },
];

/** A two-call response: assistant text, reasoning, structured reasoning details and the tool calls. */
function twoCallResponse(): Record<string, JSONValue> {
  return {
    model: "gpt-test",
    choices: [{
      message: {
        content: "I will read both files.",
        reasoning_content: "Read both first.",
        reasoning_details: ROUND_REASONING_DETAILS,
        tool_calls: ROUND_TOOL_CALLS,
      },
    }],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  };
}

/** Scripts fetch with one body per call and records every request body it receives. */
function scriptOpenAiFetch(
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

Deno.test("a response carrier replays through the next request verbatim: assistant text, reasoning, details and tool_calls", async () => {
  const scripted = scriptOpenAiFetch([twoCallResponse(), twoCallResponse()]);
  try {
    const provider = new OpenAIProvider({ apiKey: "test-key" });
    const first = await provider.generate("Plan the change.", { tools: [READ_TOOL] });
    assertEquals(first.nativeAssistantReplay, {
      provider: "openai",
      assistantContent: "I will read both files.",
      reasoningContent: "Read both first.",
      reasoningDetails: ROUND_REASONING_DETAILS,
      toolCalls: ROUND_TOOL_CALLS,
    });

    await provider.generate("Plan the change.", {
      tools: [READ_TOOL],
      priorRound: {
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
        assistant: first.nativeAssistantReplay!,
      },
    });
    const messages = scripted.sent[1].messages as Array<Record<string, JSONValue>>;
    assertEquals(messages.slice(1, 3), [
      {
        role: "assistant",
        content: "I will read both files.",
        reasoning_content: "Read both first.",
        reasoning_details: ROUND_REASONING_DETAILS,
        tool_calls: ROUND_TOOL_CALLS,
      },
      { role: "tool", tool_call_id: "call_a", content: "BODY-a" },
    ]);
    assertEquals(messages.length, 4, "one user prompt, one assistant message, one tool message per call");
  } finally {
    scripted.restore();
  }
});

Deno.test("a malformed argument string stays in the replay carrier and is absent from the executable toolCalls", async () => {
  const response = twoCallResponse();
  (response.choices as Array<{ message: { tool_calls: JSONValue } }>)[0].message.tool_calls = [
    ROUND_TOOL_CALLS[0],
    { id: "call_bad", type: "function", function: { name: "read_file", arguments: "{not json" } },
  ];
  const scripted = scriptOpenAiFetch([response]);
  try {
    const result = await new OpenAIProvider({ apiKey: "test-key" }).generate("Plan.", { tools: [READ_TOOL] });
    assertEquals(result.toolCalls?.map((call) => call.id), ["call_a"], "the legacy extractor still drops it");
    const carrier = result.nativeAssistantReplay;
    assert(carrier?.provider === "openai", "an OpenAI response carries an OpenAI replay");
    assertEquals(
      carrier.toolCalls.map((call) => call.id),
      ["call_a", "call_bad"],
      "the replay carrier keeps every original call",
    );
  } finally {
    scripted.restore();
  }
});

Deno.test("measureInputTokens counts the replayed round exactly as the request dispatches it", async () => {
  const scripted = scriptOpenAiFetch([twoCallResponse(), twoCallResponse()]);
  try {
    const provider = new OpenAIProvider({
      apiKey: "test-key",
      tokenizer: {
        countTokens: (text: string) => Promise.resolve(text.length),
        countTokensBatch: (texts: string[]) => Promise.resolve(texts.map((text) => text.length)),
      },
    });
    const round = {
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
        provider: "openai" as const,
        assistantContent: "I will read both files.",
        reasoningContent: "Read both first.",
        reasoningDetails: ROUND_REASONING_DETAILS,
        toolCalls: ROUND_TOOL_CALLS,
      },
    };
    const options = { tools: [READ_TOOL], priorRound: round };
    await provider.generate("Plan the change.", options);
    const dispatched = scripted.sent[0].messages as unknown[];
    const measured = await provider.measureInputTokens("Plan the change.", options);
    assertEquals(measured.sections.loopHistory, JSON.stringify(dispatched.slice(1)).length);
  } finally {
    scripted.restore();
  }
});

Deno.test("measureInputTokens keeps the initial prompt sections and measures a large rich result exactly", async () => {
  const provider = new OpenAIProvider({
    apiKey: "test-key",
    tokenizer: {
      countTokens: (text: string) => Promise.resolve(text.length),
      countTokensBatch: (texts: string[]) => Promise.resolve(texts.map((text) => text.length)),
    },
  });
  const richResult = [{ type: "text", text: "RICH-".repeat(800) }];
  const snapshot = {
    initialPrompt: "Plan the change.",
    initialPromptSections: [
      { section: PromptBudgetSection.SYSTEM, text: "SYSTEM-TEXT" },
      { section: PromptBudgetSection.PLAN, text: "PLAN-TEXT" },
    ],
    turns: [],
    rounds: [{
      calls: [
        {
          toolUseId: "call_a",
          index: 0,
          toolName: "read_file",
          toolInput: { path: "a.ts" },
          toolResultContent: richResult,
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
      assistant: { provider: "openai" as const, assistantContent: null, toolCalls: ROUND_TOOL_CALLS },
    }],
  };
  const options = { tools: [READ_TOOL], nativeConversation: snapshot };
  // The builder is the dispatch source: attemptGenerate sends exactly this projection.
  const dispatched = JSON.parse(
    createOpenAIChatCompletionsRequestInit("", "gpt-test", "Plan the change.", options).body as string,
  ).messages as unknown[];
  const measured = await provider.measureInputTokens("Plan the change.", options);

  assertEquals(measured.sections.plan, "PLAN-TEXT".length, "the caller's plan section is counted as given");
  assertEquals(
    measured.sections.loopHistory,
    JSON.stringify(dispatched.slice(1, 4)).length,
    "the rich result is counted in full",
  );
});
