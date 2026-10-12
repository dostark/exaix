/**
 * @module OpenRouterToolChoiceFallbackTest
 * @path packages/ai-openrouter/tests/openrouter_tool_choice_fallback_test.ts
 * @related-files ["packages/ai-openrouter/src/openrouter_provider.ts", "packages/ai-openrouter/src/openrouter_errors.ts"]
 * @architectural-layer AI
 * @description Verifies that a route which refuses a forced tool choice gets one retry with auto, for any model.
 * The adapter applies the same rule to every model, so no model name is checked.
 */

import { assertEquals, assertRejects } from "@std/assert";
import type { IModelOptions } from "@exaix/ai/types.ts";
import type { JSONValue } from "@exaix/core";
import { OpenRouterProvider, OpenRouterRoutingError } from "@exaix/ai-openrouter";

interface IReply {
  status: number;
  body: string;
}
interface IWireBody {
  tool_choice?: JSONValue;
}

const TOOL = { name: "read_file", description: "Read a file.", inputSchema: { type: "object" } };
const chat = (content: string): IReply => ({
  status: 200,
  body: JSON.stringify({
    choices: [{ message: { content } }],
    usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
  }),
});
const toolRefusal = (): IReply => ({
  status: 404,
  body: JSON.stringify({
    error: {
      code: 404,
      message: "No endpoints found that support the provided 'tool_choice' value.",
      metadata: { failed_routing_step: "Filter by Tool Compatibility" },
    },
  }),
});

async function withReplies<T>(replies: IReply[], fn: (bodies: IWireBody[]) => Promise<T>): Promise<T> {
  const origFetch = globalThis.fetch;
  const bodies: IWireBody[] = [];
  globalThis.fetch = ((_input: string | URL | Request, init?: RequestInit) => {
    bodies.push(JSON.parse((init?.body as string) ?? "{}"));
    const reply = replies[Math.min(bodies.length - 1, replies.length - 1)];
    return Promise.resolve(new Response(reply.body, { status: reply.status }));
  }) as typeof fetch;
  try {
    return await fn(bodies);
  } finally {
    globalThis.fetch = origFetch;
  }
}

const NAMED_CHOICE = { type: "function", function: { name: "read_file" } };

const provider = () => new OpenRouterProvider({ apiKey: "sk-test", model: "vendor/any-model" });
const withChoice = (toolChoice: IModelOptions["toolChoice"]): IModelOptions => ({
  tools: [TOOL],
  toolChoice,
  max_tokens: 200,
});

Deno.test("a refused any tool choice is retried once with auto", async () => {
  await withReplies([toolRefusal(), chat("ok")], async (bodies) => {
    const result = await provider().generate("read it", withChoice({ type: "any" }));
    assertEquals(bodies.length, 2);
    assertEquals(bodies[0].tool_choice, NAMED_CHOICE);
    assertEquals(bodies[1].tool_choice, "auto");
    assertEquals(result.content, "ok");
  });
});

Deno.test("a refused named tool choice is retried once with auto", async () => {
  await withReplies([toolRefusal(), chat("ok")], async (bodies) => {
    await provider().generate("read it", withChoice({ type: "tool", name: "read_file" }));
    assertEquals(bodies.length, 2);
    assertEquals(bodies[1].tool_choice, "auto");
  });
});

Deno.test("an accepted any tool choice is sent once and never changed", async () => {
  await withReplies([chat("ok")], async (bodies) => {
    await provider().generate("read it", withChoice({ type: "any" }));
    assertEquals(bodies.length, 1);
    assertEquals(bodies[0].tool_choice, NAMED_CHOICE);
  });
});

Deno.test("a refused auto tool choice is not retried", async () => {
  await withReplies([toolRefusal()], async (bodies) => {
    await assertRejects(
      () => provider().generate("read it", withChoice({ type: "auto" })),
      OpenRouterRoutingError,
    );
    assertEquals(bodies.length, 1);
  });
});

Deno.test("a route that refuses both the forced choice and auto fails closed after two requests", async () => {
  await withReplies([toolRefusal(), toolRefusal()], async (bodies) => {
    await assertRejects(
      () => provider().generate("read it", withChoice({ type: "any" })),
      OpenRouterRoutingError,
    );
    assertEquals(bodies.length, 2);
  });
});

Deno.test("a forced choice with several offered tools is sent as auto, once", async () => {
  const OTHER = { name: "list_directory", description: "List.", inputSchema: { type: "object" } };
  await withReplies([chat("ok")], async (bodies) => {
    await provider().generate("read it", { tools: [TOOL, OTHER], toolChoice: { type: "any" }, max_tokens: 200 });
    assertEquals(bodies.length, 1);
    assertEquals(bodies[0].tool_choice, "auto");
  });
});
