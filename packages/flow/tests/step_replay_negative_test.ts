/**
 * @module StepReplayNegativeTest
 * @path packages/flow/tests/step_replay_negative_test.ts
 * @description Negative tests for findReplayCandidate — input hash mismatch, traceId
 * mismatch, flowId mismatch, stepId mismatch, attemptClass mismatch, and missing
 * optional hash fields.
 */

import { assertEquals } from "@std/assert";
import { StepAttemptClass, StepExecutionDisposition, StepSideEffectClass } from "@exaix/core";
import type { IStepDurabilityStore, IStepExecutionRecord } from "@exaix/flow";

class MatchingDurabilityStore implements IStepDurabilityStore {
  private records = new Map<string, IStepExecutionRecord>();

  save(record: IStepExecutionRecord): Promise<void> {
    this.records.set(record.recordId, record);
    return Promise.resolve();
  }

  findReplayCandidate(
    query: Parameters<IStepDurabilityStore["findReplayCandidate"]>[0],
  ): Promise<IStepExecutionRecord | null> {
    return Promise.resolve().then(() => {
      for (const record of this.records.values()) {
        if (!record.replayEligible) continue;
        if (record.idempotencyKey.traceId !== query.traceId) continue;
        if (record.idempotencyKey.flowId !== query.flowId) continue;
        if (record.idempotencyKey.stepId !== query.stepId) continue;
        if (record.idempotencyKey.inputHash !== query.inputHash) continue;
        if (record.idempotencyKey.attemptClass !== query.attemptClass) continue;
        if (
          query.toolPolicyHash !== undefined &&
          record.idempotencyKey.toolPolicyHash !== query.toolPolicyHash
        ) continue;
        if (
          query.portalScopeHash !== undefined &&
          record.idempotencyKey.portalScopeHash !== query.portalScopeHash
        ) continue;
        return record;
      }
      return null;
    });
  }

  invalidate(_recordId: string, _reason: string): Promise<void> {
    return Promise.resolve();
  }

  addRecord(record: IStepExecutionRecord): void {
    this.records.set(record.recordId, record);
  }
}

function createStoredRecord(overrides: Partial<IStepExecutionRecord> = {}): IStepExecutionRecord {
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
    sideEffectClass: StepSideEffectClass.LLM,
    replayEligible: true,
    ...overrides,
  };
}

Deno.test("StepReplayNegative: findReplayCandidate returns null when inputHash mismatches", async () => {
  const store = new MatchingDurabilityStore();
  store.addRecord(createStoredRecord());

  const result = await store.findReplayCandidate({
    traceId: "trace-1",
    flowId: "flow-1",
    stepId: "step-1",
    inputHash: "different_hash_value_here_32chars___",
    attemptClass: "initial",
  });
  assertEquals(result, null);
});

Deno.test("StepReplayNegative: findReplayCandidate returns null when traceId mismatches", async () => {
  const store = new MatchingDurabilityStore();
  store.addRecord(createStoredRecord());

  const result = await store.findReplayCandidate({
    traceId: "other-trace",
    flowId: "flow-1",
    stepId: "step-1",
    inputHash: "abcdef1234567890abcdef1234567890",
    attemptClass: "initial",
  });
  assertEquals(result, null);
});

Deno.test("StepReplayNegative: findReplayCandidate returns null when flowId mismatches", async () => {
  const store = new MatchingDurabilityStore();
  store.addRecord(createStoredRecord());

  const result = await store.findReplayCandidate({
    traceId: "trace-1",
    flowId: "other-flow",
    stepId: "step-1",
    inputHash: "abcdef1234567890abcdef1234567890",
    attemptClass: "initial",
  });
  assertEquals(result, null);
});

Deno.test("StepReplayNegative: findReplayCandidate returns null when stepId mismatches", async () => {
  const store = new MatchingDurabilityStore();
  store.addRecord(createStoredRecord());

  const result = await store.findReplayCandidate({
    traceId: "trace-1",
    flowId: "flow-1",
    stepId: "other-step",
    inputHash: "abcdef1234567890abcdef1234567890",
    attemptClass: "initial",
  });
  assertEquals(result, null);
});

Deno.test("StepReplayNegative: findReplayCandidate returns null when attemptClass mismatches", async () => {
  const store = new MatchingDurabilityStore();
  store.addRecord(createStoredRecord());

  const result = await store.findReplayCandidate({
    traceId: "trace-1",
    flowId: "flow-1",
    stepId: "step-1",
    inputHash: "abcdef1234567890abcdef1234567890",
    attemptClass: "retry",
  });
  assertEquals(result, null);
});

Deno.test("StepReplayNegative: findReplayCandidate returns null when toolPolicyHash in query but not in stored record", async () => {
  const store = new MatchingDurabilityStore();
  store.addRecord(createStoredRecord());

  const result = await store.findReplayCandidate({
    traceId: "trace-1",
    flowId: "flow-1",
    stepId: "step-1",
    inputHash: "abcdef1234567890abcdef1234567890",
    attemptClass: "initial",
    toolPolicyHash: "tool-policy-hash",
  });
  assertEquals(result, null);
});

Deno.test("StepReplayNegative: findReplayCandidate returns null when record is not replayEligible", async () => {
  const store = new MatchingDurabilityStore();
  store.addRecord(createStoredRecord({ replayEligible: false }));

  const result = await store.findReplayCandidate({
    traceId: "trace-1",
    flowId: "flow-1",
    stepId: "step-1",
    inputHash: "abcdef1234567890abcdef1234567890",
    attemptClass: "initial",
  });
  assertEquals(result, null);
});

Deno.test("StepReplayNegative: findReplayCandidate returns matching record when all fields match", async () => {
  const store = new MatchingDurabilityStore();
  const stored = createStoredRecord();
  store.addRecord(stored);

  const result = await store.findReplayCandidate({
    traceId: "trace-1",
    flowId: "flow-1",
    stepId: "step-1",
    inputHash: "abcdef1234567890abcdef1234567890",
    attemptClass: "initial",
  });
  assertEquals(result?.recordId, stored.recordId);
});
