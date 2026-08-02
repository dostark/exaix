/**
 * @module CallIndexSemanticsTest
 * @path packages/execution/tests/agents/call_index_semantics_test.ts
 * @description Phase 157 Step 1 — call index = the logical call ordinal within a step,
 *   assigned once per *consumed* response. A retried logical call (internal to
 *   executeWithRetry) must keep the same index across every attempt; only a NEW logical call
 *   (a subsequent run()) advances it. This is what keeps a fixture's key stable between
 *   capture (where retries happen) and replay (where they don't).
 *
 *   Phase 157 Step 3 fix: the shared (scenarioId, stepId) counter raced across flow steps
 *   running in the same parallel wave (WaveOrchestrator.executeWave uses Promise.all) —
 *   resolveCallSite() reads the counter synchronously but markCallSiteConsumed() only
 *   advances it after the async call resolves, so a sibling step's resolveCallSite() could
 *   read the same (stale) value before the first step's call completed, landing both on the
 *   same callIndex. Verified live during the flow_blueprints pack's fixture capture: an
 *   8-step flow with maxParallelism 3 only produced 5 distinct fixture files — colliding
 *   steps silently overwrote each other's captured response. Fixed by scoping the counter
 *   (and the fixture address) by flowStepId as well, so different flow steps never share a
 *   key regardless of resolution order.
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

Deno.test("[call_index_semantics] concurrent calls for different flow steps do not collide on call index (regression: parallel-wave race)", async () => {
  const capturedCallSites: (ICallSite | undefined)[] = [];
  let releaseA: () => void = () => {};
  const gateA = new Promise<void>((resolve) => {
    releaseA = resolve;
  });
  const provider: IModelProvider = {
    id: "steady",
    async generate(_prompt: string, options?: IModelOptions): Promise<IGenerateResult> {
      capturedCallSites.push(options?.callSite);
      // Simulate step-a's real network call staying in flight while step-b's call — started
      // right after, in the same parallel wave — races ahead and completes first. Under the
      // pre-fix scheme (no flowStepId in the key) both would read callIndex 0 from the same
      // unconsumed counter; the fix must keep them distinct regardless of resolution order.
      if (options?.callSite?.flowStepId === "step-a") {
        await gateA;
      }
      return okResult("steady");
    },
  };
  const runner = new AgentRunner(provider, { disableRetry: true });

  const requestA: IParsedRequest = {
    userPrompt: "task",
    context: {},
    scenarioId: "flow_blueprints",
    stepId: "submit-flow-request",
    flowStepId: "step-a",
  };
  const requestB: IParsedRequest = {
    userPrompt: "task",
    context: {},
    scenarioId: "flow_blueprints",
    stepId: "submit-flow-request",
    flowStepId: "step-b",
  };

  const runA = runner.run(blueprint, requestA, undefined);
  const runB = runner.run(blueprint, requestB, undefined);
  await runB;
  releaseA();
  await runA;

  assertEquals(capturedCallSites[0]?.flowStepId, "step-a");
  assertEquals(capturedCallSites[0]?.callIndex, 0);
  assertEquals(capturedCallSites[1]?.flowStepId, "step-b");
  assertEquals(
    capturedCallSites[1]?.callIndex,
    0,
    "a different flow step must not collide with step-a's index even though step-a has not consumed yet",
  );
});
