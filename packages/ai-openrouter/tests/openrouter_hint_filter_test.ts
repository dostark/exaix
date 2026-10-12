/**
 * @module OpenRouterHintFilterTest
 * @path packages/ai-openrouter/tests/openrouter_hint_filter_test.ts
 * @related-files ["packages/ai-openrouter/src/openrouter_routing.ts", "packages/ai-openrouter/src/openrouter_provider.ts"]
 * @architectural-layer AI
 * @description Verifies that a sampling or parallel-call hint that the model does not list is dropped, so that
 * require_parameters guards only the features a request depends on. Without the filter a tool or schema request
 * with a temperature has no route on a model that does not accept a temperature.
 */

import { assertEquals } from "@std/assert";
import type { IModelOptions } from "@exaix/ai/types.ts";
import type { JSONValue } from "@exaix/core";
import { type IOpenRouterModelEntry, OpenRouterProvider } from "@exaix/ai-openrouter";
import { needsCapabilityEntry } from "../src/openrouter_routing.ts";

const TOOL = { name: "read_file", inputSchema: { type: "object" } };
const HINTS: IModelOptions = { temperature: 0, top_p: 0.9, stop: ["END"], max_tokens: 200 };

interface ISentBody {
  temperature?: number;
  top_p?: number;
  stop?: string[];
  max_tokens?: number;
  parallel_tool_calls?: boolean;
  tools?: JSONValue[];
  tool_choice?: JSONValue;
  reasoning?: Record<string, JSONValue>;
  provider?: { require_parameters?: boolean };
}

const entryListing = (...supportedParameters: string[]): IOpenRouterModelEntry => ({
  id: "vendor/model",
  supportedParameters,
  reasoning: { mandatory: false, supportedEfforts: [], supportsMaxTokens: false },
});

async function sentBody(
  options: IModelOptions,
  entry: IOpenRouterModelEntry | undefined,
): Promise<{ body: ISentBody; lookups: number }> {
  const origFetch = globalThis.fetch;
  let body: ISentBody = {};
  let lookups = 0;
  globalThis.fetch = ((_input: string | URL | Request, init?: RequestInit) => {
    body = JSON.parse((init?.body as string) ?? "{}");
    return Promise.resolve(
      new Response(JSON.stringify({ choices: [{ message: { content: "{}" } }] }), { status: 200 }),
    );
  }) as typeof fetch;
  try {
    const provider = new OpenRouterProvider({
      apiKey: "sk-test",
      model: "vendor/model",
      capabilities: {
        getEntry: () => {
          lookups++;
          return Promise.resolve(entry);
        },
      },
    });
    await provider.generate("hi", options);
    return { body, lookups };
  } finally {
    globalThis.fetch = origFetch;
  }
}

Deno.test("hints that the model does not list are dropped, and max_tokens is kept", async () => {
  const { body } = await sentBody({ ...HINTS, tools: [TOOL] }, entryListing("tools", "tool_choice", "max_tokens"));
  assertEquals([body.temperature, body.top_p, body.stop], [undefined, undefined, undefined]);
  assertEquals(body.max_tokens, 200);
  assertEquals(body.tools?.length, 1);
  assertEquals(body.provider?.require_parameters, true);
});

Deno.test("hints that the model lists are sent", async () => {
  const { body } = await sentBody(
    { ...HINTS, tools: [TOOL] },
    entryListing("tools", "temperature", "top_p", "stop", "max_tokens"),
  );
  assertEquals([body.temperature, body.top_p, body.stop], [0, 0.9, ["END"]]);
});

Deno.test("with no entry every hint is sent, as before", async () => {
  const { body } = await sentBody({ ...HINTS, tools: [TOOL] }, undefined);
  assertEquals([body.temperature, body.top_p, body.stop], [0, 0.9, ["END"]]);
});

Deno.test("the parallel-off flag is dropped when the model does not list parallel_tool_calls", async () => {
  const off: IModelOptions = { tools: [TOOL], toolChoice: { type: "auto", disable_parallel_tool_use: true } };
  const without = await sentBody(off, entryListing("tools", "tool_choice"));
  assertEquals(without.body.parallel_tool_calls, undefined);
  assertEquals(without.body.tool_choice !== undefined, true);
  const listed = await sentBody(off, entryListing("tools", "tool_choice", "parallel_tool_calls"));
  assertEquals(listed.body.parallel_tool_calls, false);
});

Deno.test("a reasoning-off hint with a temperature on a model that lists no temperature keeps its route", async () => {
  const { body } = await sentBody(
    { temperature: 0, max_tokens: 100, thinking: false },
    entryListing("reasoning", "max_tokens"),
  );
  assertEquals(body.reasoning, undefined);
  assertEquals(body.temperature, undefined);
});

Deno.test("a structured request with a temperature consults the capability source", async () => {
  const { body, lookups } = await sentBody(
    { temperature: 0, jsonSchema: { type: "object", additionalProperties: { type: "string" } } },
    entryListing("response_format", "max_tokens"),
  );
  assertEquals(lookups, 1);
  assertEquals(body.temperature, undefined);
});

Deno.test("needsCapabilityEntry is true for a feature or a hint, and false for a bare prompt", () => {
  assertEquals(needsCapabilityEntry({}), false);
  assertEquals(needsCapabilityEntry({ max_tokens: 100 }), false);
  assertEquals(needsCapabilityEntry({ tools: [] }), false);
  assertEquals(needsCapabilityEntry({ tools: [TOOL] }), true);
  assertEquals(needsCapabilityEntry({ temperature: 0 }), true);
  assertEquals(needsCapabilityEntry({ top_p: 1 }), true);
  assertEquals(needsCapabilityEntry({ stop: ["x"] }), true);
  assertEquals(needsCapabilityEntry({ effort: "high" }), true);
  assertEquals(needsCapabilityEntry({ jsonSchema: { type: "object" } }), true);
});
