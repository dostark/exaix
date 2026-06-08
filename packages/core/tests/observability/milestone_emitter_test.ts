/**
 * @module MilestoneEmitterTest
 * @path packages/core/tests/observability/milestone_emitter_test.ts
 * @description Contract tests for IMilestoneEmitter and NoopMilestoneEmitter
 * @architectural-layer Testing
 * @ungrounded
 */

import { assertExists } from "@std/assert";
import type { IExecutionMilestone } from "@exaix/schemas";
import type { IMilestoneEmitter } from "../../src/observability/milestone_emitter.ts";
import { NoopMilestoneEmitter } from "../../src/observability/milestone_emitter.ts";

function validMilestone(overrides: Partial<IExecutionMilestone> = {}): IExecutionMilestone {
  return {
    milestoneId: crypto.randomUUID(),
    traceId: "trace-1",
    milestoneType: "flow.started",
    requiresAttention: false,
    occurredAt: new Date().toISOString(),
    summary: "Flow started",
    ...overrides,
  };
}

Deno.test("NoopMilestoneEmitter - implements IMilestoneEmitter", () => {
  const emitter: IMilestoneEmitter = new NoopMilestoneEmitter();
  assertExists(emitter);
  assertExists(emitter.emit);
});

Deno.test("NoopMilestoneEmitter - emit resolves without error", async () => {
  const emitter = new NoopMilestoneEmitter();
  await emitter.emit(validMilestone());
});

Deno.test("NoopMilestoneEmitter - emit handles requiresAttention milestone", async () => {
  const emitter = new NoopMilestoneEmitter();
  await emitter.emit(validMilestone({
    milestoneType: "approval.gate.entered",
    requiresAttention: true,
    attentionReason: "Need approval",
  }));
});

Deno.test("NoopMilestoneEmitter - emit handles progressHint milestone", async () => {
  const emitter = new NoopMilestoneEmitter();
  await emitter.emit(validMilestone({
    milestoneType: "flow.step.completed",
    progressHint: { stepsCompleted: 1, stepsTotal: 3, currentStepLabel: "Test step" },
  }));
});

Deno.test("NoopMilestoneEmitter - emit handles parentEventId", async () => {
  const emitter = new NoopMilestoneEmitter();
  await emitter.emit(validMilestone({
    parentEventId: crypto.randomUUID(),
  }));
});

Deno.test("NoopMilestoneEmitter - multiple emits all succeed", async () => {
  const emitter = new NoopMilestoneEmitter();
  for (let i = 0; i < 10; i++) {
    await emitter.emit(validMilestone({
      milestoneId: crypto.randomUUID(),
      milestoneType: i % 2 === 0 ? "flow.step.started" : "flow.step.completed",
      summary: `Milestone ${i}`,
    }));
  }
});
