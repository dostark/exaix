/**
 * @module ProviderTransportOptionsTest
 * @path packages/ai/tests/provider_transport_options_test.ts
 * @description Verifies compatible response bounds and remote error sanitization.
 * @architectural-layer Tests
 * @dependencies [@exaix/ai]
 * @related-files [packages/ai/src/provider_common_utils.ts]
 */
import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import {
  extractOpenAICompatibleToolCalls,
  handleProviderResponse,
  performProviderCall,
} from "../src/provider_common_utils.ts";

Deno.test("compatible body overflow cancels a stream without Content-Length and releases its reader", async () => {
  let cancelled = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.enqueue(new TextEncoder().encode("oversized streamed body"));
    },
    cancel() {
      cancelled++;
    },
  });
  const response = new Response(stream);
  assertEquals(response.headers.has("content-length"), false);
  await assertRejects(
    () => handleProviderResponse(response, "openai-chat-fixture", undefined, undefined, { maxResponseBytes: 8 }),
    Error,
    "configured byte limit",
  );
  assertEquals(cancelled, 1);
  assertEquals(stream.locked, false);
});

Deno.test("compatible response handling rejects bodies above the configured byte limit", async () => {
  const response = new Response(JSON.stringify({ content: "a response that is too large" }));
  await assertRejects(
    () => handleProviderResponse(response, "openai-chat-fixture", undefined, undefined, { maxResponseBytes: 8 }),
    Error,
    "configured byte limit",
  );
});

Deno.test("compatible request byte limits reject oversized prompt and tool payloads before fetch", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCount = 0;
  globalThis.fetch = () => {
    fetchCount++;
    return Promise.resolve(new Response("{}"));
  };
  try {
    await assertRejects(
      () =>
        performProviderCall("http://127.0.0.1:4312/v1/chat/completions", { method: "POST", body: "0123456789" }, {
          id: "openai-chat-fixture",
          maxAttempts: 1,
          maxRequestBytes: 8,
        }),
      Error,
      "configured byte limit",
    );
    assertEquals(fetchCount, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("compatible HTTP errors do not expose remote response text", async () => {
  const response = new Response(JSON.stringify({ error: { message: "SECRET remote detail" } }), {
    status: 500,
    statusText: "Server Error",
  });
  const error = await assertRejects(
    () =>
      handleProviderResponse(response, "openai-chat-fixture", undefined, undefined, { exposeRemoteErrorText: false }),
    Error,
  );
  assertStringIncludes(error.message, "HTTP 500");
  if (error.message.includes("SECRET")) throw new Error("remote error detail escaped sanitization");
});

Deno.test("compatible transport suppresses raw response debug events", async () => {
  const originalFetch = globalThis.fetch;
  const events: string[] = [];
  globalThis.fetch = () => Promise.resolve(new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] })));
  try {
    const logger = {
      debug: (event: string) => {
        events.push(event);
        return Promise.resolve();
      },
    } as never;
    const result = await performProviderCall(
      "http://127.0.0.1:4312/v1/chat/completions",
      { method: "POST" },
      { id: "openai-chat-fixture", logger, maxAttempts: 1, logResponseBody: false },
    );
    assertEquals(result.content, "ok");
    assertEquals(events, []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("compatible tool parsing accepts exactly one bounded object argument payload", async () => {
  const oneCall = (argumentsText: string) => ({
    choices: [{
      message: {
        tool_calls: [{
          id: "call_1",
          type: "function" as const,
          function: { name: "read_file", arguments: argumentsText },
        }],
      },
    }],
  });
  const parsed = extractOpenAICompatibleToolCalls(oneCall('{"path":"README.md"}'), 64);
  assertEquals(parsed?.[0].input, { path: "README.md" });
  await assertRejects(
    () => Promise.resolve().then(() => extractOpenAICompatibleToolCalls(oneCall("{"), 64)),
    Error,
    "malformed",
  );
  await assertRejects(
    () =>
      Promise.resolve().then(() => extractOpenAICompatibleToolCalls(oneCall('{"path":"a very long file path"}'), 8)),
    Error,
    "configured byte limit",
  );
  const twoCalls = oneCall("{}");
  twoCalls.choices[0].message.tool_calls.push({
    id: "call_2",
    type: "function",
    function: { name: "read_file", arguments: "{}" },
  });
  await assertRejects(
    () => Promise.resolve().then(() => extractOpenAICompatibleToolCalls(twoCalls, 64)),
    Error,
    "one tool call",
  );
});
