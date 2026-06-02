/**
 * @module StepDurabilityReplayIntegrationTest
 * @path packages/flow/tests/step_durability_replay_integration_test.ts
 * @description Integration tests validating that FlowRunner skips recomputation
 * when a reusable prior execution record exists in the durability store, and falls
 * back to normal execution when no match exists.
 */

import { assertEquals } from "@std/assert";
import { encodeHex } from "@std/encoding/hex";
import {
  DefaultStepReplayPolicy,
  FlowRunner,
  type IAgentExecutor,
  type IFlowEventLogger,
  type IFlowStepRequest,
  type IStepDurabilityStore,
  type IStepExecutionRecord,
} from "@exaix/flow";
import type { IAgentExecutionResult } from "@exaix/execution";
import type { IFlow, IFlowInput } from "@exaix/schemas/flow.ts";
import type { JSONValue } from "@exaix/core";
import {
  DEFAULT_FLOW_STEP_BACKOFF_MS,
  DEFAULT_FLOW_VERSION,
  FlowInputSource,
  FlowOutputFormat,
  StepAttemptClass,
  StepExecutionDisposition,
  StepSideEffectClass,
} from "@exaix/core";

class TrackingDurabilityStore implements IStepDurabilityStore {
  records = new Map<string, IStepExecutionRecord>();
  findReplayCandidateCalls: Array<{ query: Parameters<IStepDurabilityStore["findReplayCandidate"]>[0] }> = [];
  saveCalls: Array<{ record: IStepExecutionRecord }> = [];
  invalidateCalls: Array<{ recordId: string; reason: string }> = [];

  save(record: IStepExecutionRecord): Promise<void> {
    this.saveCalls.push({ record });
    this.records.set(record.recordId, record);
    return Promise.resolve();
  }

  findReplayCandidate(
    query: Parameters<IStepDurabilityStore["findReplayCandidate"]>[0],
  ): Promise<IStepExecutionRecord | null> {
    this.findReplayCandidateCalls.push({ query });
    for (const record of this.records.values()) {
      if (!record.replayEligible) continue;
      if (record.idempotencyKey.traceId !== query.traceId) continue;
      if (record.idempotencyKey.flowId !== query.flowId) continue;
      if (record.idempotencyKey.stepId !== query.stepId) continue;
      if (record.idempotencyKey.inputHash !== query.inputHash) continue;
      if (record.idempotencyKey.attemptClass !== query.attemptClass) continue;
      return Promise.resolve(record);
    }
    return Promise.resolve(null);
  }

  invalidate(recordId: string, reason: string): Promise<void> {
    this.invalidateCalls.push({ recordId, reason });
    return Promise.resolve();
  }

  addRecord(record: IStepExecutionRecord): void {
    this.records.set(record.recordId, record);
  }
}

class TrackingAgentRunner implements IAgentExecutor {
  callCount = 0;
  calledIdentities: string[] = [];

  run(identityId: string, _request: IFlowStepRequest): Promise<IAgentExecutionResult> {
    this.callCount++;
    this.calledIdentities.push(identityId);
    return Promise.resolve({ thought: "executed", content: `result-from-${identityId}`, raw: `raw-${identityId}` });
  }
}

class MockEventLogger implements IFlowEventLogger {
  events: Array<{ event: string; payload: Record<string, JSONValue | undefined> }> = [];

  log(event: string, payload: Record<string, JSONValue | undefined>) {
    this.events.push({ event, payload });
  }
}

function buildTwoStepFlow(): IFlowInput {
  return {
    id: "replay-test-flow",
    name: "Replay Test Flow",
    description: "Tests replay skips recomputation",
    version: DEFAULT_FLOW_VERSION,
    steps: [
      {
        id: "step1",
        name: "Step 1",
        identity: "agent-replayable",
        dependsOn: [],
        input: { source: FlowInputSource.REQUEST, transform: "passthrough" },
        retry: { maxAttempts: 1, backoffMs: DEFAULT_FLOW_STEP_BACKOFF_MS },
      },
      {
        id: "step2",
        name: "Step 2",
        identity: "agent-always-run",
        dependsOn: ["step1"],
        input: { source: FlowInputSource.REQUEST, transform: "passthrough" },
        retry: { maxAttempts: 1, backoffMs: DEFAULT_FLOW_STEP_BACKOFF_MS },
      },
    ],
    output: {
      from: ["step2"],
      format: FlowOutputFormat.MARKDOWN,
    },
    settings: { maxParallelism: 3, failFast: true },
  } as IFlowInput;
}

Deno.test("StepDurabilityReplay: skips execution when reusable prior record exists", async () => {
  const store = new TrackingDurabilityStore();
  const agent = new TrackingAgentRunner();
  const logger = new MockEventLogger();
  const replayPolicy = new DefaultStepReplayPolicy();

  const inputHashHex = await computeInputHash("test input");
  const priorRecord: IStepExecutionRecord = {
    recordId: crypto.randomUUID(),
    traceId: "test-trace-id",
    flowId: "replay-test-flow",
    stepId: "step1",
    idempotencyKey: {
      traceId: "test-trace-id",
      flowId: "replay-test-flow",
      stepId: "step1",
      attemptClass: StepAttemptClass.INITIAL,
      inputHash: inputHashHex,
    },
    disposition: StepExecutionDisposition.EXECUTED,
    startedAt: new Date(Date.now() - 5000).toISOString(),
    completedAt: new Date().toISOString(),
    inputHash: inputHashHex,
    sideEffectClass: StepSideEffectClass.LLM,
    replayEligible: true,
    summary: "replayed-content",
  };
  store.addRecord(priorRecord);

  const runner = new FlowRunner({
    agentExecutor: agent,
    eventLogger: logger,
    stepDurabilityStore: store,
    stepReplayPolicy: replayPolicy,
  });

  const result = await runner.execute(buildTwoStepFlow() as IFlow, {
    userPrompt: "test input",
    traceId: "test-trace-id",
  });

  assertEquals(result.success, true);

  const step1FindCalls = store.findReplayCandidateCalls.filter((c) => c.query.stepId === "step1");
  assertEquals(step1FindCalls.length >= 1, true, "findReplayCandidate should be called for step1");

  assertEquals(agent.callCount, 1, "Only step2 should be executed (step1 replayed)");
  assertEquals(agent.calledIdentities, ["agent-always-run"], "Only step2 agent should run");
});

Deno.test("StepDurabilityReplay: executes normally when no prior record exists", async () => {
  const store = new TrackingDurabilityStore();
  const agent = new TrackingAgentRunner();
  const logger = new MockEventLogger();
  const replayPolicy = new DefaultStepReplayPolicy();

  const runner = new FlowRunner({
    agentExecutor: agent,
    eventLogger: logger,
    stepDurabilityStore: store,
    stepReplayPolicy: replayPolicy,
  });

  const result = await runner.execute(buildTwoStepFlow() as IFlow, {
    userPrompt: "fresh run",
    traceId: "fresh-trace",
  });

  assertEquals(result.success, true);
  assertEquals(agent.callCount, 2, "Both steps should execute fresh");
  assertEquals(agent.calledIdentities, ["agent-replayable", "agent-always-run"]);
});

async function computeInputHash(userPrompt: string): Promise<string> {
  const serialized = JSON.stringify({ userPrompt, context: {}, skills: undefined });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(serialized));
  return encodeHex(digest);
}

Deno.test("StepDurabilityReplay: does not crash when replay policy is not provided", async () => {
  const store = new TrackingDurabilityStore();
  const agent = new TrackingAgentRunner();
  const logger = new MockEventLogger();

  const priorRecord: IStepExecutionRecord = {
    recordId: crypto.randomUUID(),
    traceId: "no-policy-trace",
    flowId: "replay-test-flow",
    stepId: "step1",
    idempotencyKey: {
      traceId: "no-policy-trace",
      flowId: "replay-test-flow",
      stepId: "step1",
      attemptClass: StepAttemptClass.INITIAL,
      inputHash: "abcdef1234567890abcdef1234567890",
    },
    disposition: StepExecutionDisposition.EXECUTED,
    startedAt: new Date(Date.now() - 5000).toISOString(),
    inputHash: "abcdef1234567890abcdef1234567890",
    sideEffectClass: StepSideEffectClass.LLM,
    replayEligible: true,
  };
  store.addRecord(priorRecord);

  const runner = new FlowRunner({
    agentExecutor: agent,
    eventLogger: logger,
    stepDurabilityStore: store,
  });

  const result = await runner.execute(buildTwoStepFlow() as IFlow, {
    userPrompt: "no policy",
    traceId: "no-policy-trace",
  });

  assertEquals(result.success, true);
  assertEquals(agent.callCount, 2, "Without replay policy, both steps should execute fresh");
});
