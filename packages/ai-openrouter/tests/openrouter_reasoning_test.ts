/**
 * @module OpenRouterReasoningTest
 * @path packages/ai-openrouter/tests/openrouter_reasoning_test.ts
 * @related-files ["packages/ai-openrouter/src/openrouter_reasoning.ts", "packages/ai-openrouter/src/openrouter_provider.ts"]
 * @architectural-layer AI
 * @description Verifies that the run's effort, thinking budget and thinking switch reach OpenRouter only in
 * the forms that the model's own capability entry accepts, and that nothing is sent when it accepts none.
 */

import { assertEquals } from "@std/assert";
import type { IModelOptions } from "@exaix/ai/types.ts";
import type { JSONValue } from "@exaix/core";
import { type IOpenRouterModelEntry, OpenRouterProvider } from "@exaix/ai-openrouter";
import { reasoningFor } from "../src/openrouter_reasoning.ts";

interface ICapturedBody {
  reasoning?: Record<string, JSONValue>;
  provider?: { require_parameters?: boolean };
  include_reasoning?: boolean;
}

const entry = (reasoning?: IOpenRouterModelEntry["reasoning"]): IOpenRouterModelEntry => ({
  id: "vendor/model",
  supportedParameters: ["reasoning"],
  ...(reasoning ? { reasoning } : {}),
});
const EFFORTS = entry({ mandatory: false, supportedEfforts: ["high", "low"], supportsMaxTokens: false });
const BUDGET = entry({ mandatory: false, supportedEfforts: [], supportsMaxTokens: true });
const BOTH = entry({ mandatory: false, supportedEfforts: ["medium", "high"], supportsMaxTokens: true });
const NEITHER = entry({ mandatory: false, supportedEfforts: [], supportsMaxTokens: false });
const MANDATORY = entry({ mandatory: true, supportedEfforts: [], supportsMaxTokens: false });

Deno.test("an effort in the supported list is sent as reasoning.effort", () => {
  assertEquals(reasoningFor({ effort: "high" }, EFFORTS), { effort: "high" });
  assertEquals(reasoningFor({ effort: "low" }, EFFORTS), { effort: "low" });
});

Deno.test("the extended effort tiers are sent as they are when the model lists them", () => {
  const extended = entry({ mandatory: false, supportedEfforts: ["max", "xhigh", "high"], supportsMaxTokens: false });
  assertEquals(reasoningFor({ effort: "xhigh" }, extended), { effort: "xhigh" });
  assertEquals(reasoningFor({ effort: "max" }, extended), { effort: "max" });
  assertEquals(reasoningFor({ effort: "xhigh" }, EFFORTS), undefined);
});

Deno.test("an effort outside the supported list, or with no entry, is not sent and not remapped", () => {
  assertEquals(reasoningFor({ effort: "medium" }, EFFORTS), undefined);
  assertEquals(reasoningFor({ effort: "high" }, BUDGET), undefined);
  assertEquals(reasoningFor({ effort: "high" }, undefined), undefined);
});

Deno.test("a thinking budget is sent as reasoning.max_tokens only when the model supports it", () => {
  assertEquals(reasoningFor({ thinking_budget: 512 }, BUDGET), { max_tokens: 512 });
  assertEquals(reasoningFor({ thinking_budget: 512 }, EFFORTS), undefined);
  assertEquals(reasoningFor({ thinking_budget: 512 }, undefined), undefined);
});

Deno.test("thinking false is sent as effort none where the model lists none", () => {
  const withNone = entry({ mandatory: false, supportedEfforts: ["high", "none"], supportsMaxTokens: false });
  assertEquals(reasoningFor({ thinking: false }, withNone), { effort: "none" });
});

Deno.test("thinking false on an optional model that lists no none sends no reasoning control, never enabled false", () => {
  assertEquals(reasoningFor({ thinking: false }, NEITHER), undefined);
  assertEquals(reasoningFor({ thinking: false }, MANDATORY), undefined);
  assertEquals(reasoningFor({ thinking: false }, entry()), undefined);
  assertEquals(reasoningFor({ thinking: false }, undefined), undefined);
});

Deno.test("effort and a thinking budget together send the effort only", () => {
  assertEquals(reasoningFor({ effort: "high", thinking_budget: 512 }, BOTH), { effort: "high" });
  assertEquals(reasoningFor({ effort: "low", thinking_budget: 512 }, BOTH), { max_tokens: 512 });
});

Deno.test("no reasoning option sends no reasoning field", () => {
  assertEquals(reasoningFor({}, BOTH), undefined);
  assertEquals(reasoningFor({ thinking: true }, BOTH), undefined);
});

async function capturedBody(
  options: IModelOptions,
  modelEntry: IOpenRouterModelEntry | undefined,
): Promise<ICapturedBody> {
  const origFetch = globalThis.fetch;
  let captured: ICapturedBody = {};
  globalThis.fetch = ((_input: string | URL | Request, init?: RequestInit) => {
    captured = JSON.parse((init?.body as string) ?? "{}");
    return Promise.resolve(
      new Response(JSON.stringify({ choices: [{ message: { content: "ok" }, finish_reason: "stop" }] }), {
        status: 200,
      }),
    );
  }) as typeof fetch;
  try {
    const provider = new OpenRouterProvider({
      apiKey: "sk-test",
      model: "vendor/model",
      capabilities: { getEntry: () => Promise.resolve(modelEntry) },
    });
    await provider.generate("hi", options);
    return captured;
  } finally {
    globalThis.fetch = origFetch;
  }
}

Deno.test("a reasoning field reaches the wire body and sets provider.require_parameters true", async () => {
  const body = await capturedBody({ effort: "high" }, EFFORTS);
  assertEquals(body.reasoning, { effort: "high" });
  assertEquals(body.provider?.require_parameters, true);
});

Deno.test("no reasoning field is sent for an unsupported effort, and the deprecated include_reasoning is never sent", async () => {
  const body = await capturedBody({ effort: "medium", thinking: false }, MANDATORY);
  assertEquals(body.reasoning, undefined);
  assertEquals(body.include_reasoning, undefined);
});

Deno.test("a response without reasoning is accepted", async () => {
  const body = await capturedBody({}, EFFORTS);
  assertEquals(body.reasoning, undefined);
});

Deno.test("a mandatory-reasoning model gets its lowest listed effort when thinking is off", () => {
  const glm = entry({ mandatory: true, supportedEfforts: ["max", "high", "low"], supportsMaxTokens: false });
  assertEquals(reasoningFor({ thinking: false }, glm), { effort: "low" });
});

Deno.test("the lowest effort follows tier order, not the order the model lists", () => {
  const unordered = entry({ mandatory: true, supportedEfforts: ["medium", "high", "low"], supportsMaxTokens: false });
  assertEquals(reasoningFor({ thinking: false }, unordered), { effort: "low" });
  const minimal = entry({ mandatory: true, supportedEfforts: ["low", "minimal"], supportsMaxTokens: false });
  assertEquals(reasoningFor({ thinking: false }, minimal), { effort: "minimal" });
});
