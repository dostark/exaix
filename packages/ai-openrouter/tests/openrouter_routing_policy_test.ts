/**
 * @module OpenRouterRoutingPolicyTest
 * @path packages/ai-openrouter/tests/openrouter_routing_policy_test.ts
 * @related-files ["packages/ai-openrouter/src/openrouter_provider.ts", "packages/ai-openrouter/src/openrouter_routing.ts"]
 * @architectural-layer AI
 * @description Verifies that a request carrying a routed feature asks OpenRouter to require parameter
 * support, that an operator value always wins, and that the trace id becomes the sticky session key only
 * when no manual provider order is set.
 */

import { assertEquals } from "@std/assert";
import type { IModelOptions } from "@exaix/ai/types.ts";
import type { JSONValue } from "@exaix/core";
import { OpenRouterProvider } from "../src/openrouter_provider.ts";
import type { IOpenRouterRouting } from "../src/openrouter_provider.ts";
import { applyRequireParameters } from "../src/openrouter_routing.ts";
import type { IOpenRouterPolicyTarget } from "../src/openrouter_routing.ts";
import { OPENROUTER_SESSION_ID_MAX_CHARS } from "../src/constants.ts";

interface ICapturedBody {
  provider?: Record<string, JSONValue>;
  session_id?: string;
}

const TOOL = { name: "read_file", inputSchema: { type: "object" } };

async function capturedBodyOf(options?: IModelOptions, routing?: IOpenRouterRouting): Promise<ICapturedBody> {
  const origFetch = globalThis.fetch;
  let captured: ICapturedBody = {};
  globalThis.fetch = ((_input: string | URL | Request, init?: RequestInit) => {
    captured = JSON.parse((init?.body as string) ?? "{}");
    return Promise.resolve(
      new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 }),
    );
  }) as typeof fetch;
  try {
    await new OpenRouterProvider({ apiKey: "sk-test", model: "qwen/qwen3.7-flash", routing }).generate("hi", options);
    return captured;
  } finally {
    globalThis.fetch = origFetch;
  }
}

Deno.test("a request with tools sends provider.require_parameters true by default", async () => {
  const body = await capturedBodyOf({ tools: [TOOL] });
  assertEquals(body.provider, { require_parameters: true });
});

Deno.test("an empty tools array does not set require_parameters", async () => {
  const body = await capturedBodyOf({ tools: [] });
  assertEquals(body.provider, undefined);
});

Deno.test("a body with no routed feature has no provider.require_parameters", async () => {
  assertEquals((await capturedBodyOf({})).provider, undefined);
  assertEquals((await capturedBodyOf({}, { provider: { sort: "latency" } })).provider, { sort: "latency" });
});

Deno.test("operator require_parameters false with tools is serialized false", async () => {
  const body = await capturedBodyOf({ tools: [TOOL] }, { provider: { require_parameters: false } });
  assertEquals(body.provider, { require_parameters: false });
});

Deno.test("operator require_parameters true without a feature is serialized true", async () => {
  const body = await capturedBodyOf({}, { provider: { require_parameters: true } });
  assertEquals(body.provider, { require_parameters: true });
});

Deno.test("the automatic rule merges into an existing provider block", async () => {
  const body = await capturedBodyOf({ tools: [TOOL] }, { provider: { only: ["alibaba"] }, zdr: true });
  assertEquals(body.provider, { only: ["alibaba"], zdr: true, require_parameters: true });
});

Deno.test("allow_fallbacks and quantizations are serialized unchanged", async () => {
  const body = await capturedBodyOf({}, { provider: { allow_fallbacks: false, quantizations: ["fp8", "bf16"] } });
  assertEquals(body.provider, { allow_fallbacks: false, quantizations: ["fp8", "bf16"] });
});

Deno.test("require_parameters is set when the final body carries tools, response_format or reasoning", () => {
  const required = (body: IOpenRouterPolicyTarget) => {
    applyRequireParameters(body);
    return body.provider?.require_parameters === true;
  };
  assertEquals(required({}), false);
  assertEquals(required({ tools: [] }), false);
  assertEquals(required({ tools: [{}] }), true);
  assertEquals(required({ response_format: { type: "json_object" } }), true);
  assertEquals(required({ reasoning: { effort: "high" } }), true);
});

Deno.test("a trace id with no provider.order is sent as the sticky session key", async () => {
  const traceId = crypto.randomUUID();
  assertEquals((await capturedBodyOf({ traceId })).session_id, traceId);
  assertEquals((await capturedBodyOf({ traceId }, { provider: { only: ["alibaba"] } })).session_id, traceId);
});

Deno.test("a trace id with provider.order sends no session key, because order disables sticky routing", async () => {
  const body = await capturedBodyOf({ traceId: crypto.randomUUID() }, { provider: { order: ["alibaba"] } });
  assertEquals(body.session_id, undefined);
});

Deno.test("no trace id, or one over the documented length, sends no session key", async () => {
  assertEquals((await capturedBodyOf({})).session_id, undefined);
  const tooLong = "t".repeat(OPENROUTER_SESSION_ID_MAX_CHARS + 1);
  assertEquals((await capturedBodyOf({ traceId: tooLong })).session_id, undefined);
});
