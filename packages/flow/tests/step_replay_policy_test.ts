/**
 * @module StepReplayPolicyTest
 * @path packages/flow/tests/step_replay_policy_test.ts
 * @description Unit tests for DefaultStepReplayPolicy — verifies replay eligibility
 * based on side-effect classification: NONE and LLM are replayable by default,
 * TOOL, GIT, and MIXED are denied.
 */

import { assertEquals } from "@std/assert";
import { StepAttemptClass, StepExecutionDisposition, StepSideEffectClass } from "@exaix/core";
import { DefaultStepReplayPolicy } from "@exaix/flow";
import type { IStepDurabilityStore, IStepExecutionRecord } from "@exaix/flow";

function createPriorRecord(sideEffectClass: StepSideEffectClass): IStepExecutionRecord {
  return {
    recordId: crypto.randomUUID(),
    traceId: "trace-1",
    flowId: "flow-1",
    stepId: "step-1",
    idempotencyKey: {
      traceId: "trace-1",
      flowId: "flow-1",
      stepId: "step-1",
      attemptClass: StepAttemptClass.INITIAL,
      inputHash: "abcdef1234567890abcdef1234567890",
    },
    disposition: StepExecutionDisposition.EXECUTED,
    startedAt: new Date().toISOString(),
    inputHash: "abcdef1234567890abcdef1234567890",
    sideEffectClass,
    replayEligible: true,
  };
}

Deno.test("DefaultStepReplayPolicy: allows replay for NONE side effect class", () => {
  const policy = new DefaultStepReplayPolicy();
  const prior = createPriorRecord(StepSideEffectClass.NONE);
  const result = policy.canReuse({
    step: { userPrompt: "test", context: {} },
    prior,
    currentInputHash: prior.inputHash,
  });
  assertEquals(result.allowed, true);
});

Deno.test("DefaultStepReplayPolicy: allows replay for LLM side effect class", () => {
  const policy = new DefaultStepReplayPolicy();
  const prior = createPriorRecord(StepSideEffectClass.LLM);
  const result = policy.canReuse({
    step: { userPrompt: "test", context: {} },
    prior,
    currentInputHash: prior.inputHash,
  });
  assertEquals(result.allowed, true);
});

Deno.test("DefaultStepReplayPolicy: denies replay for TOOL side effect class", () => {
  const policy = new DefaultStepReplayPolicy();
  const prior = createPriorRecord(StepSideEffectClass.TOOL);
  const result = policy.canReuse({
    step: { userPrompt: "test", context: {} },
    prior,
    currentInputHash: prior.inputHash,
  });
  assertEquals(result.allowed, false);
  assertEquals(typeof result.reason, "string");
});

Deno.test("DefaultStepReplayPolicy: denies replay for GIT side effect class", () => {
  const policy = new DefaultStepReplayPolicy();
  const prior = createPriorRecord(StepSideEffectClass.GIT);
  const result = policy.canReuse({
    step: { userPrompt: "test", context: {} },
    prior,
    currentInputHash: prior.inputHash,
  });
  assertEquals(result.allowed, false);
  assertEquals(typeof result.reason, "string");
});

Deno.test("DefaultStepReplayPolicy: denies replay for MIXED side effect class", () => {
  const policy = new DefaultStepReplayPolicy();
  const prior = createPriorRecord(StepSideEffectClass.MIXED);
  const result = policy.canReuse({
    step: { userPrompt: "test", context: {} },
    prior,
    currentInputHash: prior.inputHash,
  });
  assertEquals(result.allowed, false);
  assertEquals(typeof result.reason, "string");
});

// ---------------------------------------------------------------------------
// Store-level toolPolicyHash discrimination
// ---------------------------------------------------------------------------

class ToolPolicyAwareStore implements IStepDurabilityStore {
  private records: IStepExecutionRecord[] = [];

  add(record: IStepExecutionRecord): void {
    this.records.push(record);
  }

  save(_record: IStepExecutionRecord): Promise<void> {
    return Promise.resolve();
  }

  findReplayCandidate(
    query: Parameters<IStepDurabilityStore["findReplayCandidate"]>[0],
  ): Promise<IStepExecutionRecord | null> {
    for (const r of this.records) {
      if (!r.replayEligible) continue;
      if (r.idempotencyKey.traceId !== query.traceId) continue;
      if (r.idempotencyKey.flowId !== query.flowId) continue;
      if (r.idempotencyKey.stepId !== query.stepId) continue;
      if (r.idempotencyKey.inputHash !== query.inputHash) continue;
      if (
        query.toolPolicyHash !== undefined &&
        r.idempotencyKey.toolPolicyHash !== undefined &&
        r.idempotencyKey.toolPolicyHash !== query.toolPolicyHash
      ) continue;
      return Promise.resolve(r);
    }
    return Promise.resolve(null);
  }

  invalidate(_recordId: string, _reason: string): Promise<void> {
    return Promise.resolve();
  }
}

Deno.test("ToolPolicyAwareStore: toolPolicyHash mismatch prevents replay candidate match", async () => {
  const store = new ToolPolicyAwareStore();
  const prior = createPriorRecord(StepSideEffectClass.LLM);
  prior.idempotencyKey.toolPolicyHash = "hash-policy-a";
  store.add(prior);

  const noMatch = await store.findReplayCandidate({
    traceId: "trace-1",
    flowId: "flow-1",
    stepId: "step-1",
    attemptClass: "initial",
    inputHash: prior.inputHash,
    toolPolicyHash: "hash-policy-b",
  });
  assertEquals(noMatch, null, "Different toolPolicyHash must prevent candidate match");

  const match = await store.findReplayCandidate({
    traceId: "trace-1",
    flowId: "flow-1",
    stepId: "step-1",
    attemptClass: "initial",
    inputHash: prior.inputHash,
    toolPolicyHash: "hash-policy-a",
  });
  assertEquals(match?.recordId, prior.recordId, "Matching toolPolicyHash must return the record");
});
