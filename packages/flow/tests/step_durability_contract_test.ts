/**
 * @module StepDurabilityContractTest
 * @path packages/flow/tests/step_durability_contract_test.ts
 * @description Contract tests ensuring IStepDurabilityStore and IStepReplayPolicy
 * interfaces are satisfied by no-op implementations and are backward-compatible.
 */

import { assertEquals } from "@std/assert";
import { StepAttemptClass, StepExecutionDisposition, StepSideEffectClass } from "@exaix/core";
import type { IStepDurabilityStore, IStepExecutionRecord, IStepReplayPolicy } from "@exaix/flow";

class NoOpDurabilityStore implements IStepDurabilityStore {
  save(_record: IStepExecutionRecord): Promise<void> {
    return Promise.resolve();
  }

  findReplayCandidate(
    _query: Parameters<IStepDurabilityStore["findReplayCandidate"]>[0],
  ): Promise<IStepExecutionRecord | null> {
    return Promise.resolve(null);
  }

  invalidate(_recordId: string, _reason: string): Promise<void> {
    return Promise.resolve();
  }
}

class NoOpReplayPolicy implements IStepReplayPolicy {
  canReuse(
    _params: Parameters<IStepReplayPolicy["canReuse"]>[0],
  ): { allowed: boolean; reason?: string } {
    return { allowed: false, reason: "NoOp policy: replay not allowed" };
  }
}

// `save resolves without error` sat here, constructing a fifteen-field durability record in order
// to call a NO-OP store's save() and assert nothing. A method defined to do nothing doing nothing
// is not a fact worth a test, and the record shape had to be maintained in step with the interface
// for no return. `invalidate resolves without error` was the same shape and is also gone. What
// remains below is the behaviour that can actually differ: what the no-op store RETURNS, and that
// it satisfies the interface.
Deno.test("NoOpDurabilityStore: findReplayCandidate returns null", async () => {
  const store = new NoOpDurabilityStore();
  const result = await store.findReplayCandidate({
    traceId: "trace-1",
    flowId: "flow-1",
    stepId: "step-1",
    inputHash: "abcdef1234567890",
    attemptClass: "initial",
    toolPolicyHash: "toolhash",
    portalScopeHash: "portalhash",
  });
  assertEquals(result, null);
});

Deno.test("NoOpDurabilityStore: findReplayCandidate returns null without optional fields", async () => {
  const store = new NoOpDurabilityStore();
  const result = await store.findReplayCandidate({
    traceId: "trace-1",
    flowId: "flow-1",
    stepId: "step-1",
    inputHash: "abcdef1234567890",
    attemptClass: "retry",
  });
  assertEquals(result, null);
});

Deno.test("NoOpReplayPolicy: canReuse returns denied by default", () => {
  const policy = new NoOpReplayPolicy();
  const result = policy.canReuse({
    step: {
      userPrompt: "test",
      context: {},
    },
    prior: {
      recordId: crypto.randomUUID(),
      traceId: "t",
      flowId: "f",
      stepId: "s",
      idempotencyKey: {
        traceId: "t",
        flowId: "f",
        stepId: "s",
        attemptClass: StepAttemptClass.INITIAL,
        inputHash: "abcdef1234567890",
      },
      disposition: StepExecutionDisposition.EXECUTED,
      startedAt: new Date().toISOString(),
      inputHash: "abcdef1234567890",
      sideEffectClass: StepSideEffectClass.LLM,
      replayEligible: true,
    },
    currentInputHash: "abcdef1234567890",
  });
  assertEquals(result.allowed, false);
  assertEquals(result.reason, "NoOp policy: replay not allowed");
});

Deno.test("NoOpDurabilityStore: satisfies interface contract shape", () => {
  const store: IStepDurabilityStore = new NoOpDurabilityStore();
  assertEquals(typeof store.save, "function");
  assertEquals(typeof store.findReplayCandidate, "function");
  assertEquals(typeof store.invalidate, "function");
});

Deno.test("NoOpReplayPolicy: satisfies interface contract shape", () => {
  const policy: IStepReplayPolicy = new NoOpReplayPolicy();
  assertEquals(typeof policy.canReuse, "function");
});
