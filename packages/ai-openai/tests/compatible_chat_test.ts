/**
 * @module CompatibleChatTest
 * @path packages/ai-openai/tests/compatible_chat_test.ts
 * @description Exercises compatible chat generation against a real bounded loopback HTTP fixture.
 * @architectural-layer Tests
 * @dependencies [@exaix/ai-openai, @exaix/testing]
 * @related-files [packages/ai-openai/src/openai_provider.ts]
 */
import { assertEquals, assertExists, assertRejects } from "@std/assert";
import type { IResolvedProviderOptions } from "@exaix/ai/types.ts";
import type { IModelOptions } from "@exaix/ai/types.ts";
import { ProviderRegistry } from "@exaix/ai/provider_registry.ts";
import { MockProviderFactory } from "@exaix/ai/factories/mock_factory.ts";
import { type JSONValue, PricingTier, ProviderCostTier, ProviderType } from "@exaix/core";
import { withEnv } from "@exaix/testing/helpers/env.ts";
import { OpenAICompatibleProviderFactory } from "../src/compatible_factory.ts";
import { OpenAIProvider } from "../src/openai_provider.ts";
import { createCompatibleChatRequestInit } from "../src/compatible_chat.ts";
import { TracedProvider } from "@exaix/ai/traced_provider.ts";
import { createMockLogger } from "@exaix/testing";

interface IFixtureChatMessage {
  role: string;
  content?: string;
  reasoning_content?: string;
  tool_call_id?: string;
  tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
}

interface IFixtureChatRequest {
  messages: IFixtureChatMessage[];
  tool_choice: string;
  parallel_tool_calls?: boolean;
  temperature?: number;
  top_p?: number;
  thinking?: { type: string };
}

Deno.test("compatible deadline aborts an unfinished HTTP response body with one logical terminal", async () => {
  let requests = 0;
  let streamController: ReadableStreamDefaultController<Uint8Array> | undefined;
  const server = Deno.serve({ hostname: "127.0.0.1", port: 0, onListen: () => {} }, () => {
    requests++;
    return new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          streamController = controller;
          controller.enqueue(new TextEncoder().encode('{"model":'));
        },
      }),
    );
  });
  try {
    const endpoint = `http://127.0.0.1:${(server.addr as Deno.NetAddr).port}/v1/chat/completions`;
    const logger = createMockLogger();
    const provider = new TracedProvider(
      new OpenAIProvider({
        apiKey: "fixture-key",
        model: "compat-fixture-v1",
        baseUrl: endpoint,
        timeoutMs: 200,
        maxRetries: 3,
        compatible: {
          profile: "local-test",
          endpoint,
          allow_insecure_loopback: true,
          max_response_bytes: 4096,
          max_tool_argument_bytes: 512,
          max_history_bytes: 4096,
        },
      }),
      logger,
    );
    const error = await assertRejects(
      () => provider.generate("fixture prompt", { traceId: "body-timeout-trace" }),
      Error,
    );
    assertEquals(error.name, "TimeoutError");
    assertEquals(requests, 1);
    assertEquals(logger.info.calls.length, 1);
    assertEquals(logger.warn.calls.length, 1);
    assertEquals(logger.log.calls.length, 0);
    assertEquals(logger.warn.calls[0].args[3], "body-timeout-trace");
  } finally {
    try {
      streamController?.close();
    } catch { /* The aborted client can already have cancelled the stream. */ }
    await server.shutdown();
  }
});

Deno.test("compatible HTTP failures obey status retry policy and expose one redacted terminal event", async (t) => {
  for (
    const { status, attempts, body } of [
      { status: 401, attempts: 1, body: '{"error":{"type":"rate_limit_error","message":"remote-sensitive"}}' },
      { status: 403, attempts: 1, body: "remote-sensitive" },
      { status: 429, attempts: 3, body: "remote-sensitive" },
      { status: 500, attempts: 3, body: '{"error":{"type":"authentication_error","message":"remote-sensitive"}}' },
    ]
  ) {
    await t.step(`HTTP ${status}`, async () => {
      let requests = 0;
      const server = Deno.serve({ hostname: "127.0.0.1", port: 0, onListen: () => {} }, () => {
        requests++;
        return new Response(body, { status });
      });
      try {
        const endpoint = `http://127.0.0.1:${(server.addr as Deno.NetAddr).port}/v1/chat/completions`;
        const logger = createMockLogger();
        const provider = new TracedProvider(
          new OpenAIProvider({
            apiKey: "fixture-sensitive-key",
            model: "compat-fixture-v1",
            baseUrl: endpoint,
            id: "openai-chat-compat-fixture-v1",
            maxRetries: 3,
            retryDelayMs: 1,
            timeoutMs: 1000,
            compatible: {
              profile: "local-test",
              endpoint,
              allow_insecure_loopback: true,
              max_response_bytes: 4096,
              max_tool_argument_bytes: 512,
              max_history_bytes: 4096,
            },
            logger,
          }),
          logger,
        );
        const error = await assertRejects(
          () => provider.generate("fixture-sensitive-prompt", { traceId: "http-status-trace" }),
          Error,
        );
        assertEquals(requests, attempts);
        assertEquals(logger.info.calls.length, 1);
        assertEquals(logger.warn.calls.length, 1);
        assertEquals(logger.log.calls.length, 0);
        assertEquals(logger.warn.calls[0].args[3], "http-status-trace");
        assertEquals(
          JSON.stringify([error.message, logger.warn.calls, logger.debug.calls]).includes("sensitive"),
          false,
        );
      } finally {
        await server.shutdown();
      }
    });
  }
});

Deno.test("compatible chat replays the immutable native conversation through loopback HTTP", async () => {
  ProviderRegistry.clear();
  ProviderRegistry.registerWithMetadata("openai-chat", new MockProviderFactory(), {
    name: "openai-chat",
    description: "Compatible fixture",
    capabilities: ["chat", "tools"],
    costTier: ProviderCostTier.LOCAL,
    pricingTier: PricingTier.LOCAL,
    strengths: [],
    supportsNativeTools: true,
    supportsNativeConversation: true,
    chatFormat: "openai",
  });
  let requestBody: IFixtureChatRequest | undefined;
  let authorization: string | null = null;
  const server = Deno.serve({ hostname: "127.0.0.1", port: 0, onListen: () => {} }, async (request: Request) => {
    authorization = request.headers.get("authorization");
    requestBody = await request.json();
    return Response.json({
      model: "compat-fixture-v1",
      choices: [{ message: { role: "assistant", content: "done" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 20, completion_tokens: 2, total_tokens: 22 },
    });
  });
  const port = (server.addr as Deno.NetAddr).port;
  try {
    await withEnv({ EXA_COMPAT_TEST_API_KEY: "local-fixture-secret" }, async () => {
      const options: IResolvedProviderOptions = {
        provider: ProviderType.OPENAI_CHAT,
        model: "compat-fixture-v1",
        timeoutMs: 1000,
        compatible: {
          profile: "local-test",
          endpoint: `http://127.0.0.1:${port}/v1/chat/completions`,
          model: "compat-fixture-v1",
          allow_insecure_loopback: true,
          max_response_bytes: 4096,
          max_tool_argument_bytes: 512,
          max_history_bytes: 4096,
        },
      };
      const provider = await new OpenAICompatibleProviderFactory().create(options);
      const callOptions: IModelOptions = {
        tools: [{
          name: "read_file",
          description: "Read one permitted file",
          inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
        }],
        toolChoice: { type: "auto", disable_parallel_tool_use: true },
        nativeConversation: {
          initialPrompt: "Read the requested file",
          turns: [{
            toolUseId: "call-17",
            toolName: "read_file",
            toolInput: { path: "README.md" },
            toolResultContent: "fixture file contents",
            toolResultIsError: false,
          }],
          roundInstruction: "Continue or return the final answer.",
        },
      };
      const result = await provider.generate("Read the requested file", callOptions);
      assertEquals(result.content, "done");
      assertEquals(result.costStatus, "unknown");
    });
  } finally {
    await server.shutdown();
    ProviderRegistry.clear();
  }

  assertEquals(authorization, "Bearer local-fixture-secret");
  assertExists(requestBody);
  const messages = requestBody.messages;
  assertEquals(messages.map((message) => message.role), ["user", "assistant", "tool", "user"]);
  assertEquals(messages[0].content, "Read the requested file");
  const assistant = messages[1];
  const toolCalls = assistant.tool_calls!;
  assertEquals(toolCalls[0].id, "call-17");
  assertEquals(toolCalls[0].function.name, "read_file");
  assertEquals(messages[2].tool_call_id, "call-17");
  assertEquals(messages[2].content, "fixture file contents");
  assertEquals(messages[3].content, "Continue or return the final answer.");
  assertEquals(requestBody.tool_choice, "auto");
});

Deno.test("compatible chat rejects redirects before a redirected request reaches its destination", async () => {
  ProviderRegistry.clear();
  ProviderRegistry.registerWithMetadata("openai-chat", new MockProviderFactory(), {
    name: "openai-chat",
    description: "Compatible fixture",
    capabilities: ["chat", "tools"],
    costTier: ProviderCostTier.LOCAL,
    pricingTier: PricingTier.LOCAL,
    strengths: [],
    supportsNativeTools: true,
    supportsNativeConversation: true,
    chatFormat: "openai",
  });
  let redirectedCalls = 0;
  const server = Deno.serve({ hostname: "127.0.0.1", port: 0, onListen: () => {} }, (request: Request) => {
    if (new URL(request.url).pathname === "/redirected") {
      redirectedCalls++;
      return Response.json({ choices: [{ message: { content: "unexpected" } }] });
    }
    return new Response(null, { status: 302, headers: { Location: "/redirected" } });
  });
  const port = (server.addr as Deno.NetAddr).port;
  try {
    await withEnv({ EXA_COMPAT_TEST_API_KEY: "local-fixture-secret" }, async () => {
      const provider = await new OpenAICompatibleProviderFactory().create({
        provider: ProviderType.OPENAI_CHAT,
        model: "compat-fixture-v1",
        timeoutMs: 1000,
        compatible: {
          profile: "local-test",
          endpoint: `http://127.0.0.1:${port}/v1/chat/completions`,
          model: "compat-fixture-v1",
          allow_insecure_loopback: true,
          max_response_bytes: 4096,
          max_tool_argument_bytes: 512,
          max_history_bytes: 4096,
        },
      });
      await assertRejects(() => provider.generate("test"), Error);
    });
    assertEquals(redirectedCalls, 0);
  } finally {
    await server.shutdown();
    ProviderRegistry.clear();
  }
});

Deno.test("compatible response validation rejects invalid protocol before returning executable calls", async (t) => {
  const call = { id: "call-1", type: "function", function: { name: "read_file", arguments: '{"path":"a"}' } };
  const usage = { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 };
  const cases: Array<{ name: string; response: JSONValue }> = [
    {
      name: "missing usage",
      response: {
        model: "returned-model",
        choices: [{ message: { role: "assistant", content: "done" }, finish_reason: "stop" }],
      },
    },
    {
      name: "negative usage",
      response: {
        model: "returned-model",
        usage: { ...usage, prompt_tokens: -1 },
        choices: [{ message: { role: "assistant", content: "done" }, finish_reason: "stop" }],
      },
    },
    ...[
      {
        name: "unadvertised name",
        message: {
          role: "assistant",
          content: null,
          tool_calls: [{ ...call, function: { ...call.function, name: "write_file" } }],
        },
        finish_reason: "tool_calls",
      },
      {
        name: "empty call id",
        message: { role: "assistant", content: null, tool_calls: [{ ...call, id: "" }] },
        finish_reason: "tool_calls",
      },
      {
        name: "multiple calls",
        message: { role: "assistant", content: null, tool_calls: [call, { ...call, id: "call-2" }] },
        finish_reason: "tool_calls",
      },
      {
        name: "malformed arguments",
        message: {
          role: "assistant",
          content: null,
          tool_calls: [{ ...call, function: { ...call.function, arguments: "sensitive-malformed" } }],
        },
        finish_reason: "tool_calls",
      },
      {
        name: "array arguments",
        message: {
          role: "assistant",
          content: null,
          tool_calls: [{ ...call, function: { ...call.function, arguments: "[]" } }],
        },
        finish_reason: "tool_calls",
      },
      {
        name: "oversized arguments",
        message: {
          role: "assistant",
          content: null,
          tool_calls: [{
            ...call,
            function: { ...call.function, arguments: JSON.stringify({ path: "x".repeat(513) }) },
          }],
        },
        finish_reason: "tool_calls",
      },
      { name: "truncated output", message: { role: "assistant", content: "partial" }, finish_reason: "length" },
      {
        name: "contradictory stop",
        message: { role: "assistant", content: null, tool_calls: [call] },
        finish_reason: "stop",
      },
      { name: "empty final", message: { role: "assistant", content: "" }, finish_reason: "stop" },
      {
        name: "refusal",
        message: { role: "assistant", content: "no", refusal: "sensitive-refusal" },
        finish_reason: "stop",
      },
    ].map(({ name, ...choice }) => ({ name, response: { model: "returned-model", usage, choices: [choice] } })),
  ];
  let response: JSONValue = null;
  let requests = 0;
  const server = Deno.serve({ hostname: "127.0.0.1", port: 0, onListen: () => {} }, () => {
    requests++;
    return Response.json(response);
  });
  const endpoint = `http://127.0.0.1:${(server.addr as Deno.NetAddr).port}/v1/chat/completions`;
  const provider = new OpenAIProvider({
    apiKey: "local-key",
    model: "requested-model",
    baseUrl: endpoint,
    compatible: {
      profile: "local-test",
      endpoint,
      allow_insecure_loopback: true,
      model: "requested-model",
      max_response_bytes: 4096,
      max_tool_argument_bytes: 512,
      max_history_bytes: 4096,
    },
  });
  try {
    for (const invalid of cases) {
      await t.step(invalid.name, async () => {
        response = invalid.response;
        const before = requests;
        const error = await assertRejects(
          () => provider.generate("prompt", { tools: [{ name: "read_file", inputSchema: { type: "object" } }] }),
          Error,
        );
        assertEquals(error.message.includes("sensitive-"), false);
        assertEquals(requests - before, 1);
      });
    }
    await t.step("returned model and cache usage remain distinct from requested model", async () => {
      response = {
        model: "returned-model",
        usage: { ...usage, prompt_tokens_details: { cached_tokens: 3 } },
        choices: [{ message: { role: "assistant", content: "done" }, finish_reason: "stop" }],
      };
      const result = await provider.generate("prompt");
      assertEquals(result.model, "returned-model");
      assertEquals(result.usage.cacheReadTokens, 3);
      assertEquals(result.cost_usd, undefined);
    });
  } finally {
    await server.shutdown();
  }
});

Deno.test("compatible chat omits DeepSeek's unsupported parallel_tool_calls switch and its thinking-mode sampling fields", async () => {
  let requestBody: IFixtureChatRequest | undefined;
  const server = Deno.serve({ hostname: "127.0.0.1", port: 0, onListen: () => {} }, async (request: Request) => {
    requestBody = await request.json();
    return Response.json({
      model: "deepseek-flash",
      choices: [{ message: { role: "assistant", content: "done" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
    });
  });
  const endpoint = `http://127.0.0.1:${(server.addr as Deno.NetAddr).port}/v1/chat/completions`;
  try {
    const provider = new OpenAIProvider({
      apiKey: "deepseek-fixture-key",
      model: "deepseek-flash",
      baseUrl: endpoint,
      compatible: {
        profile: "deepseek",
        endpoint,
        allow_insecure_loopback: true,
        max_response_bytes: 4096,
        max_tool_argument_bytes: 512,
        max_history_bytes: 4096,
      },
    });
    await provider.generate("prompt", {
      temperature: 0.4,
      top_p: 0.9,
      thinking: true,
      tools: [{
        name: "read_file",
        description: "Read one permitted file",
        inputSchema: { type: "object", properties: { path: { type: "string" } } },
      }],
      toolChoice: { type: "auto", disable_parallel_tool_use: true },
    });
    assertExists(requestBody);
    assertEquals(requestBody.parallel_tool_calls, undefined);
    assertEquals(requestBody.thinking, { type: "enabled" });
    assertEquals(requestBody.temperature, undefined);
    assertEquals(requestBody.top_p, undefined);

    await provider.generate("prompt", { temperature: 0.4, top_p: 0.9, thinking: false });
    assertEquals(requestBody!.thinking, { type: "disabled" });
    assertEquals(requestBody!.temperature, 0.4);
    assertEquals(requestBody!.top_p, 0.9);
  } finally {
    await server.shutdown();
  }
});

Deno.test("compatible chat rejects explicit thinking on the OpenAI profile's pinned nonreasoning model", async () => {
  const endpoint = "http://127.0.0.1:1/v1/chat/completions";
  const provider = new OpenAIProvider({
    apiKey: "fixture-key",
    model: "gpt-4.1-mini-2025-04-14",
    baseUrl: endpoint,
    compatible: {
      profile: "openai",
      endpoint,
      allow_insecure_loopback: true,
      max_response_bytes: 4096,
      max_tool_argument_bytes: 512,
      max_history_bytes: 4096,
    },
  });
  const error = await assertRejects(() => provider.generate("prompt", { thinking: true }), Error);
  assertEquals(error.name, "ProviderCallPolicyError");
  await assertRejects(() => provider.generate("prompt", { effort: "medium" }));
});

Deno.test("compatible chat still sets parallel_tool_calls:false for the OpenAI and local-test profiles", async () => {
  for (const profile of ["openai", "local-test"] as const) {
    let requestBody: IFixtureChatRequest | undefined;
    const server = Deno.serve({ hostname: "127.0.0.1", port: 0, onListen: () => {} }, async (request: Request) => {
      requestBody = await request.json();
      return Response.json({
        model: "requested-model",
        choices: [{ message: { role: "assistant", content: "done" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
      });
    });
    const endpoint = `http://127.0.0.1:${(server.addr as Deno.NetAddr).port}/v1/chat/completions`;
    try {
      const provider = new OpenAIProvider({
        apiKey: "fixture-key",
        model: "requested-model",
        baseUrl: endpoint,
        compatible: {
          profile,
          endpoint,
          allow_insecure_loopback: true,
          max_response_bytes: 4096,
          max_tool_argument_bytes: 512,
          max_history_bytes: 4096,
        },
      });
      await provider.generate("prompt", {
        tools: [{ name: "read_file", description: "Read a file", inputSchema: { type: "object" } }],
        toolChoice: { type: "auto", disable_parallel_tool_use: true },
      });
      assertEquals(requestBody?.parallel_tool_calls, false, profile);
    } finally {
      await server.shutdown();
    }
  }
});

Deno.test("compatible chat preserves DeepSeek reasoning_content across two successive tool turns to a final answer", async () => {
  ProviderRegistry.clear();
  ProviderRegistry.registerWithMetadata("openai-chat", new MockProviderFactory(), {
    name: "openai-chat",
    description: "Compatible fixture",
    capabilities: ["chat", "tools"],
    costTier: ProviderCostTier.LOCAL,
    pricingTier: PricingTier.LOCAL,
    strengths: [],
    supportsNativeTools: true,
    supportsNativeConversation: true,
    chatFormat: "openai",
  });
  const seenRequests: IFixtureChatRequest[] = [];
  let round = 0;
  const server = Deno.serve({ hostname: "127.0.0.1", port: 0, onListen: () => {} }, async (request: Request) => {
    seenRequests.push(await request.json());
    round++;
    if (round === 1) {
      return Response.json({
        model: "deepseek-flash",
        choices: [{
          message: {
            role: "assistant",
            content: null,
            reasoning_content: "Considering the second file next.",
            tool_calls: [{
              id: "call-2",
              type: "function",
              function: { name: "read_file", arguments: '{"path":"b.md"}' },
            }],
          },
          finish_reason: "tool_calls",
        }],
        usage: { prompt_tokens: 30, completion_tokens: 5, total_tokens: 35 },
      });
    }
    return Response.json({
      model: "deepseek-flash",
      choices: [{ message: { role: "assistant", content: "both files read" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 40, completion_tokens: 4, total_tokens: 44 },
    });
  });
  const port = (server.addr as Deno.NetAddr).port;
  const endpoint = `http://127.0.0.1:${port}/v1/chat/completions`;
  try {
    await (async () => {
      // Constructed directly: the real factory pins "deepseek" to its real host.
      const provider = new OpenAIProvider({
        apiKey: "deepseek-fixture-key",
        model: "deepseek-flash",
        baseUrl: endpoint,
        compatible: {
          profile: "deepseek",
          endpoint,
          allow_insecure_loopback: true,
          max_response_bytes: 4096,
          max_tool_argument_bytes: 512,
          max_history_bytes: 4096,
        },
      });
      const tools = [{
        name: "read_file",
        description: "Read one permitted file",
        inputSchema: { type: "object", properties: { path: { type: "string" } } },
      }];
      // Round 1: one completed turn (call-1) already replayed, and the fixture returns call-2.
      const firstRound: IModelOptions = {
        thinking: true,
        tools,
        toolChoice: { type: "auto", disable_parallel_tool_use: true },
        nativeConversation: {
          initialPrompt: "Read both requested files",
          turns: [{
            toolUseId: "call-1",
            toolName: "read_file",
            toolInput: { path: "a.md" },
            toolResultContent: "contents of a.md",
            toolResultIsError: false,
            reasoningContent: "Reading the first file.",
          }],
          roundInstruction: "Continue or return the final answer.",
        },
      };
      const firstResult = await provider.generate("Read both requested files", firstRound);
      const secondCall = firstResult.toolCalls?.[0];
      assertExists(secondCall);
      assertEquals(secondCall.id, "call-2");
      assertEquals(secondCall.reasoningContent, "Considering the second file next.");

      // Round 2 mirrors the real caller: append call-2's result as a completed turn
      // and replay the full two-turn snapshot.
      const secondRound: IModelOptions = {
        ...firstRound,
        nativeConversation: {
          ...firstRound.nativeConversation!,
          turns: [
            ...firstRound.nativeConversation!.turns,
            {
              toolUseId: secondCall.id,
              toolName: secondCall.name,
              toolInput: secondCall.input,
              toolResultContent: "contents of b.md",
              toolResultIsError: false,
              reasoningContent: secondCall.reasoningContent,
            },
          ],
        },
      };
      const secondResult = await provider.generate("Read both requested files", secondRound);
      assertEquals(secondResult.content, "both files read");
    })();
  } finally {
    await server.shutdown();
    ProviderRegistry.clear();
  }

  assertEquals(round, 2);
  const firstRequest = seenRequests[0];
  const firstAssistant = firstRequest.messages.find((m) => m.role === "assistant");
  assertEquals(firstAssistant?.reasoning_content, "Reading the first file.");
  const firstTool = firstRequest.messages.find((m) => m.role === "tool");
  assertEquals(firstTool?.tool_call_id, "call-1");

  const secondRequest = seenRequests[1];
  const secondTool = secondRequest.messages.find((m) => m.tool_call_id === "call-2");
  assertEquals(secondTool?.content, "contents of b.md");
  assertEquals(secondRequest.messages.filter((m) => m.role === "assistant").length, 2);
  assertEquals(
    secondRequest.messages.some((m) => m.reasoning_content === "Considering the second file next."),
    true,
  );
});

Deno.test("compatible chat sends OpenAI strict json_schema mode for a representable schema and reports its mode", async () => {
  let requestBody: (IFixtureChatRequest & { response_format?: JSONValue }) | undefined;
  const server = Deno.serve({ hostname: "127.0.0.1", port: 0, onListen: () => {} }, async (request: Request) => {
    requestBody = await request.json();
    return Response.json({
      model: "gpt-4.1-mini-2025-04-14",
      choices: [{ message: { role: "assistant", content: '{"title":"t"}' }, finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
    });
  });
  const endpoint = `http://127.0.0.1:${(server.addr as Deno.NetAddr).port}/v1/chat/completions`;
  try {
    const provider = new OpenAIProvider({
      apiKey: "fixture-key",
      model: "gpt-4.1-mini-2025-04-14",
      baseUrl: endpoint,
      compatible: {
        profile: "openai",
        endpoint,
        allow_insecure_loopback: true,
        max_response_bytes: 4096,
        max_tool_argument_bytes: 512,
        max_history_bytes: 4096,
      },
    });
    const result = await provider.generate("prompt", {
      jsonSchema: { type: "object", properties: { title: { type: "string" } }, required: ["title"] },
    });
    assertExists(requestBody);
    const responseFormat = requestBody!.response_format as Record<string, JSONValue>;
    assertEquals(responseFormat.type, "json_schema");
    assertEquals(result.structuredOutputMode, "json_schema");
    assertEquals(result.structuredOutputModeReason, undefined);
    assertEquals(result.content, '{"title":"t"}');
  } finally {
    await server.shutdown();
  }
});

Deno.test("compatible chat falls back to json_object mode and instruction text for a non-strict-representable schema", async () => {
  let requestBody: (IFixtureChatRequest & { response_format?: JSONValue }) | undefined;
  const server = Deno.serve({ hostname: "127.0.0.1", port: 0, onListen: () => {} }, async (request: Request) => {
    requestBody = await request.json();
    return Response.json({
      model: "requested-model",
      choices: [{ message: { role: "assistant", content: '{"title":"t","note":null}' }, finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
    });
  });
  const endpoint = `http://127.0.0.1:${(server.addr as Deno.NetAddr).port}/v1/chat/completions`;
  try {
    const provider = new OpenAIProvider({
      apiKey: "fixture-key",
      model: "requested-model",
      baseUrl: endpoint,
      compatible: {
        profile: "openai",
        endpoint,
        allow_insecure_loopback: true,
        max_response_bytes: 4096,
        max_tool_argument_bytes: 512,
        max_history_bytes: 4096,
      },
    });
    const result = await provider.generate("prompt", {
      jsonSchema: {
        type: "object",
        properties: {
          title: { type: "string" },
          params: { type: "object", additionalProperties: { type: "string" } },
        },
        required: ["title"],
      },
    });
    assertExists(requestBody);
    const responseFormat = requestBody!.response_format as Record<string, JSONValue>;
    assertEquals(responseFormat.type, "json_object");
    assertEquals(result.structuredOutputMode, "json_object");
    assertEquals(result.structuredOutputModeReason, "schema_not_strict_representable");
    const systemMessage = requestBody!.messages.find((m) => m.role === "system" || m.role === "user");
    assertExists(systemMessage);
  } finally {
    await server.shutdown();
  }
});

Deno.test("json_object instruction stays on the user prompt after a prior tool turn", () => {
  const request = createCompatibleChatRequestInit("key", "model", "final prompt", {
    jsonSchema: {
      type: "object",
      properties: { params: { type: "object", additionalProperties: { type: "string" } } },
    },
    priorTurn: {
      toolUseId: "read-1",
      toolName: "read_file",
      toolInput: { path: "a.md" },
      toolResultContent: "file contents",
      toolResultIsError: false,
    },
  }, "local-test");
  const body = JSON.parse(request.init.body as string) as {
    messages: Array<{ role: string; content: string | null; tool_calls?: Array<{ id: string }> }>;
  };
  assertEquals(body.messages[0].role, "assistant");
  assertEquals(body.messages[0].content, null);
  assertExists(body.messages[0].tool_calls);
  assertEquals(body.messages[2].role, "user");
  assertEquals(
    body.messages[2].content,
    "final prompt\n\nRespond with a single json object matching the supplied schema. No prose, no markdown fence.",
  );
});

Deno.test("compatible chat rejects structured output content that violates the schema", async () => {
  const server = Deno.serve({ hostname: "127.0.0.1", port: 0, onListen: () => {} }, () => {
    return Response.json({
      model: "requested-model",
      choices: [{ message: { role: "assistant", content: '{"title":123}' }, finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
    });
  });
  const endpoint = `http://127.0.0.1:${(server.addr as Deno.NetAddr).port}/v1/chat/completions`;
  try {
    const provider = new OpenAIProvider({
      apiKey: "fixture-key",
      model: "requested-model",
      baseUrl: endpoint,
      compatible: {
        profile: "openai",
        endpoint,
        allow_insecure_loopback: true,
        max_response_bytes: 4096,
        max_tool_argument_bytes: 512,
        max_history_bytes: 4096,
      },
    });
    await assertRejects(() =>
      provider.generate("prompt", {
        jsonSchema: { type: "object", properties: { title: { type: "string" } }, required: ["title"] },
      })
    );
  } finally {
    await server.shutdown();
  }
});
