/**
 * @module CallIndexSemanticsTest
 * @path packages/execution/tests/agents/call_index_semantics_test.ts
 * @description Phase 157 Step 1 — call index = the logical call ordinal within a step,
 *   assigned once per *consumed* response. A retried logical call (internal to
 *   executeWithRetry) must keep the same index across every attempt; only a NEW logical call
 *   (a subsequent run()) advances it. This is what keeps a fixture's key stable between
 *   capture (where retries happen) and replay (where they don't).
 * @architectural-layer Services
 * @related-files [packages/execution/src/agent_runner.ts]
 */

import { assertEquals } from "@std/assert";
import { AgentRunner, type IBlueprint, type IParsedRequest } from "@exaix/execution";
import type { ICallSite } from "@exaix/ai/types.ts";
import type { IGenerateResult } from "@exaix/ai/providers";
import type { IModelOptions, IModelProvider } from "@exaix/ai/types.ts";

const blueprint: IBlueprint = { systemPrompt: "system prompt" };

function okResult(providerId: string): IGenerateResult {
  return {
    content: "<thought>ok</thought><content>ok</content>",
    usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    model: "mock-model",
    provider: providerId,
  };
}

Deno.test("[call_index_semantics] a retried logical call keeps the same call index across every attempt", async () => {
  let attempt = 0;
  const capturedCallSites: (ICallSite | undefined)[] = [];
  const provider: IModelProvider = {
    id: "flaky",
    generate(_prompt: string, options?: IModelOptions): Promise<IGenerateResult> {
      capturedCallSites.push(options?.callSite);
      attempt++;
      if (attempt === 1) return Promise.reject(new Error("rate limit exceeded, please retry"));
      return Promise.resolve(okResult("flaky"));
    },
  };
  const runner = new AgentRunner(provider, {
    retryPolicy: { maxRetries: 1, initialDelayMs: 1, maxDelayMs: 1, jitterFactor: 0 },
  });
  const request: IParsedRequest = {
    userPrompt: "task",
    context: {},
    scenarioId: "flow_blueprints",
    stepId: "step-a",
  };

  await runner.run(blueprint, request, undefined);

  assertEquals(capturedCallSites.length, 2, "the retry policy must have retried once");
  assertEquals(capturedCallSites[0]?.callIndex, 0);
  assertEquals(capturedCallSites[1]?.callIndex, 0, "a retry within the same logical call keeps its call index");
});

Deno.test("[call_index_semantics] the next logical call advances the call index", async () => {
  const capturedCallSites: (ICallSite | undefined)[] = [];
  const provider: IModelProvider = {
    id: "steady",
    generate(_prompt: string, options?: IModelOptions): Promise<IGenerateResult> {
      capturedCallSites.push(options?.callSite);
      return Promise.resolve(okResult("steady"));
    },
  };
  const runner = new AgentRunner(provider, { disableRetry: true });
  const request: IParsedRequest = {
    userPrompt: "task",
    context: {},
    scenarioId: "flow_blueprints",
    stepId: "step-b",
  };

  await runner.run(blueprint, request, undefined);
  await runner.run(blueprint, request, undefined);

  assertEquals(capturedCallSites.map((c) => c?.callIndex), [0, 1]);
});

Deno.test("[call_index_semantics] separate steps within the same scenario each start their own call index at 0", async () => {
  const capturedCallSites: (ICallSite | undefined)[] = [];
  const provider: IModelProvider = {
    id: "steady",
    generate(_prompt: string, options?: IModelOptions): Promise<IGenerateResult> {
      capturedCallSites.push(options?.callSite);
      return Promise.resolve(okResult("steady"));
    },
  };
  const runner = new AgentRunner(provider, { disableRetry: true });

  await runner.run(blueprint, {
    userPrompt: "task",
    context: {},
    scenarioId: "flow_blueprints",
    stepId: "step-c1",
  }, undefined);
  await runner.run(blueprint, {
    userPrompt: "task",
    context: {},
    scenarioId: "flow_blueprints",
    stepId: "step-c2",
  }, undefined);

  assertEquals(capturedCallSites.map((c) => c?.callIndex), [0, 0]);
});
