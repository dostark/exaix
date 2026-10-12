/**
 * @module OpenRouterStructuredOutputTest
 * @path packages/ai-openrouter/tests/openrouter_structured_output_test.ts
 * @related-files ["packages/ai-openrouter/src/openrouter_provider.ts", "packages/ai-openrouter/src/openrouter_structured_output.ts"]
 * @architectural-layer AI
 * @description Verifies that a request with a JSON schema sends the strongest response format that the
 * route accepts, falls back to json_object once when the route refuses json_schema, fails closed when
 * both are refused, and returns schema-valid JSON or a typed error, never free text.
 */

import { assert, assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { ProviderProtocolError } from "@exaix/ai/errors.ts";
import { STRUCTURED_OUTPUT_JSON_MODE_INSTRUCTION } from "@exaix/ai/constants.ts";
import type { IModelOptions } from "@exaix/ai/types.ts";
import type { JSONValue } from "@exaix/core";
import { PricingTier } from "@exaix/core";
import { ProviderRegistry } from "@exaix/ai/provider_registry.ts";
import {
  OPENROUTER_PROVIDER_METADATA,
  OpenRouterProvider,
  OpenRouterProviderFactory,
  OpenRouterRoutingError,
  OpenRouterTruncationError,
  PROVIDER_OPENROUTER,
} from "@exaix/ai-openrouter";

const STRICT_SCHEMA: Record<string, JSONValue> = {
  type: "object",
  properties: { files: { type: "array", items: { type: "string" } }, count: { type: "integer" } },
  required: ["files", "count"],
  additionalProperties: false,
};
const RECORD_SCHEMA: Record<string, JSONValue> = { type: "object", additionalProperties: { type: "string" } };
const VALID_JSON = JSON.stringify({ files: ["a.txt", "b.txt"], count: 2 });

interface IWireMessage {
  role: string;
  content: string | null | Array<{ type: string; text: string; cache_control: { type: string } }>;
}
interface IWireBody {
  messages: IWireMessage[];
  response_format?: { type: string; json_schema?: { strict?: boolean } };
  provider?: { require_parameters?: boolean };
}
interface IReply {
  status: number;
  body: string;
}

const chat = (content: string | null, extra: Record<string, JSONValue> = {}): IReply => ({
  status: 200,
  body: JSON.stringify({
    choices: [{ message: { content, ...extra } }],
    usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
  }),
});
const routingRefusal = (): IReply => ({
  status: 404,
  body: JSON.stringify({
    error: {
      code: 404,
      message: "No endpoints found that can handle the requested parameters.",
      metadata: { failed_routing_step: "Filter by Parameters" },
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

const provider = (): OpenRouterProvider =>
  new OpenRouterProvider({ apiKey: "sk-test", model: "qwen/qwen3.7-flash", retryDelayMs: 1 });
const optionsFor = (jsonSchema: Record<string, JSONValue>, extra: IModelOptions = {}): IModelOptions => ({
  jsonSchema,
  ...extra,
});

Deno.test("a strict-representable schema sends response_format json_schema with strict true", async () => {
  await withReplies([chat(VALID_JSON)], async (bodies) => {
    const result = await provider().generate("list files", optionsFor(STRICT_SCHEMA));
    assertEquals(bodies.length, 1);
    assertEquals(bodies[0].response_format?.type, "json_schema");
    assertEquals(bodies[0].response_format?.json_schema?.strict, true);
    assertEquals(result.structuredOutputMode, "json_schema");
    assertEquals(result.structuredOutputModeReason, undefined);
    assertEquals(JSON.parse(result.content), { files: ["a.txt", "b.txt"], count: 2 });
  });
});

Deno.test("a schema that is not strict-representable sends json_object with the instruction and its reason", async () => {
  await withReplies([chat('{"a":"x"}')], async (bodies) => {
    const result = await provider().generate("list files", optionsFor(RECORD_SCHEMA));
    assertEquals(bodies[0].response_format, { type: "json_object" });
    assertEquals(bodies[0].messages.at(-1)?.content, [{
      type: "text",
      text: `list files\n\n${STRUCTURED_OUTPUT_JSON_MODE_INSTRUCTION}`,
      cache_control: { type: "ephemeral" },
    }]);
    assertEquals(result.structuredOutputMode, "json_object");
    assertEquals(result.structuredOutputModeReason, "schema_not_strict_representable");
  });
});

Deno.test("a routing refusal of json_schema retries once with json_object and reports route_refused_json_schema", async () => {
  await withReplies([routingRefusal(), chat(VALID_JSON)], async (bodies) => {
    const result = await provider().generate("list files", optionsFor(STRICT_SCHEMA));
    assertEquals(bodies.length, 2);
    assertEquals(bodies[0].response_format?.type, "json_schema");
    assertEquals(bodies[1].response_format, { type: "json_object" });
    assertEquals(bodies[1].messages.at(-1)?.content, [{
      type: "text",
      text: `list files\n\n${STRUCTURED_OUTPUT_JSON_MODE_INSTRUCTION}`,
      cache_control: { type: "ephemeral" },
    }]);
    assertEquals(result.structuredOutputMode, "json_object");
    assertEquals(result.structuredOutputModeReason, "route_refused_json_schema");
  });
});

Deno.test("a routing refusal of both modes fails closed with OpenRouterRoutingError after two fetches", async () => {
  await withReplies([routingRefusal()], async (bodies) => {
    await assertRejects(() => provider().generate("list files", optionsFor(STRICT_SCHEMA)), OpenRouterRoutingError);
    assertEquals(bodies.length, 2);
  });
});

Deno.test("a refused json_object plan is not retried, because there is no weaker mode", async () => {
  await withReplies([routingRefusal()], async (bodies) => {
    await assertRejects(() => provider().generate("list files", optionsFor(RECORD_SCHEMA)), OpenRouterRoutingError);
    assertEquals(bodies.length, 1);
  });
});

Deno.test("non-JSON content throws ProviderProtocolError and is fetched once", async () => {
  await withReplies([chat("Sure, here are the files.")], async (bodies) => {
    await assertRejects(() => provider().generate("list files", optionsFor(STRICT_SCHEMA)), ProviderProtocolError);
    assertEquals(bodies.length, 1);
  });
});

Deno.test("schema-invalid JSON throws ProviderProtocolError that names the validation failure", async () => {
  await withReplies([chat(JSON.stringify({ files: "a.txt", count: "two" }))], async () => {
    const error = await assertRejects(
      () => provider().generate("list files", optionsFor(STRICT_SCHEMA)),
      ProviderProtocolError,
    );
    assertStringIncludes(error.message, "Structured output failed schema validation");
  });
});

Deno.test("an empty reply for a structured request throws ProviderProtocolError", async () => {
  await withReplies([chat(null)], async () => {
    await assertRejects(() => provider().generate("list files", optionsFor(STRICT_SCHEMA)), ProviderProtocolError);
  });
});

Deno.test("an unsupported schema keyword throws before any fetch", async () => {
  await withReplies([chat(VALID_JSON)], async (bodies) => {
    await assertRejects(
      () => provider().generate("list files", optionsFor({ type: "string", pattern: "^a" })),
      ProviderProtocolError,
      "Unsupported structured-output schema",
    );
    assertEquals(bodies.length, 0);
  });
});

Deno.test("[regression] without jsonSchema the body has no response_format and the result no mode", async () => {
  await withReplies([chat("plain text")], async (bodies) => {
    const result = await provider().generate("hi");
    assertEquals(bodies[0].response_format, undefined);
    assertEquals(result.structuredOutputMode, undefined);
    assertEquals(result.content, "plain text");
  });
});

Deno.test("a response_format sets provider.require_parameters true through the routing rule", async () => {
  await withReplies([chat(VALID_JSON)], async (bodies) => {
    await provider().generate("list files", optionsFor(STRICT_SCHEMA));
    assertEquals(bodies[0].provider?.require_parameters, true);
  });
});

Deno.test("with a native conversation the json_object instruction goes into the first projected message", async () => {
  const nativeConversation = {
    initialPrompt: "list files",
    turns: [],
    rounds: [],
    roundInstruction: "Continue.",
  };
  ProviderRegistry.clear();
  ProviderRegistry.registerWithMetadata(PROVIDER_OPENROUTER, new OpenRouterProviderFactory(), {
    ...OPENROUTER_PROVIDER_METADATA,
    capabilities: [...OPENROUTER_PROVIDER_METADATA.capabilities],
    strengths: [...OPENROUTER_PROVIDER_METADATA.strengths],
    pricingTier: PricingTier.MEDIUM,
    supportsNativeConversation: true,
  });
  try {
    await withReplies([chat('{"a":"x"}')], async (bodies) => {
      await provider().generate("list files", optionsFor(RECORD_SCHEMA, { nativeConversation }));
      assertEquals(bodies[0].messages[0].content, [{
        type: "text",
        text: `list files\n\n${STRUCTURED_OUTPUT_JSON_MODE_INSTRUCTION}`,
        cache_control: { type: "ephemeral" },
      }]);
      assertEquals(bodies[0].messages.at(-1)?.content, "Continue.");
    });
  } finally {
    ProviderRegistry.clear();
  }
});

Deno.test("a tool-calling reply to a structured request is returned without content validation", async () => {
  const toolCall = [{ id: "call_1", type: "function", function: { name: "read_file", arguments: '{"path":"a.txt"}' } }];
  await withReplies([chat(null, { tool_calls: toolCall })], async () => {
    const result = await provider().generate(
      "list files",
      optionsFor(STRICT_SCHEMA, { tools: [{ name: "read_file", inputSchema: { type: "object" } }] }),
    );
    assertEquals(result.toolCalls?.length, 1);
    assertEquals(result.structuredOutputMode, "json_schema");
  });
});

Deno.test("measureInputTokens counts the json_object instruction", async () => {
  const without = await provider().measureInputTokens("list files", {});
  const withInstruction = await provider().measureInputTokens("list files", optionsFor(RECORD_SCHEMA));
  assert(withInstruction.totalTokens > without.totalTokens);
});

const chatFinishing = (content: string, finishReason: string): IReply => ({
  status: 200,
  body: JSON.stringify({
    choices: [{ message: { content }, finish_reason: finishReason }],
    usage: {
      prompt_tokens: 5,
      completion_tokens: 1500,
      total_tokens: 1505,
      completion_tokens_details: { reasoning_tokens: 900 },
    },
  }),
});

Deno.test("a structured reply cut off at the token limit throws the truncation error, not a validation error", async () => {
  await withReplies([chatFinishing('{"files":["a.txt","b.t', "length")], async (bodies) => {
    const error = await assertRejects(
      () => provider().generate("list files", optionsFor(STRICT_SCHEMA)),
      OpenRouterTruncationError,
    );
    assertStringIncludes(error.message, "max_tokens");
    assertStringIncludes(error.message, "reasoning_tokens=900");
    assertEquals(bodies.length, 1);
  });
});

Deno.test("a complete structured reply is accepted even when the finish reason is length", async () => {
  await withReplies([chatFinishing(VALID_JSON, "length")], async () => {
    const result = await provider().generate("list files", optionsFor(STRICT_SCHEMA));
    assertEquals(JSON.parse(result.content), { files: ["a.txt", "b.txt"], count: 2 });
    assertEquals(result.stop_reason, "length");
  });
});

Deno.test("a schema-invalid structured reply that finished normally stays a validation error", async () => {
  await withReplies([chatFinishing(JSON.stringify({ files: "a.txt" }), "stop")], async () => {
    await assertRejects(() => provider().generate("list files", optionsFor(STRICT_SCHEMA)), ProviderProtocolError);
  });
});
