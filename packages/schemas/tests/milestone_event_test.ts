/**
 * @module MilestoneEventTest
 * @path packages/schemas/tests/milestone_event_test.ts
 * @description Schema validation tests for ExecutionMilestoneSchema
 * @architectural-layer Testing
 * @ungrounded
 */

import { assertEquals } from "@std/assert";
import { ExecutionMilestoneSchema } from "@exaix/schemas";
import {
  MILESTONE_APPROVAL_GATE_ENTERED,
  MILESTONE_APPROVAL_GATE_RESOLVED,
  MILESTONE_CHILD_RUN_COMPLETED,
  MILESTONE_CHILD_RUN_SPAWNED,
  MILESTONE_CONTEXT_COMPACTION_APPLIED,
  MILESTONE_FLOW_COMPLETED,
  MILESTONE_FLOW_FAILED,
  MILESTONE_FLOW_STARTED,
  MILESTONE_FLOW_STEP_COMPLETED,
  MILESTONE_FLOW_STEP_REPLAYED,
  MILESTONE_FLOW_STEP_SKIPPED,
  MILESTONE_FLOW_STEP_STARTED,
  MILESTONE_LLM_CALL_COMPLETED,
  MILESTONE_LLM_CALL_STARTED,
  MILESTONE_RESOURCE_LOCK_ACQUIRED,
  MILESTONE_RESOURCE_LOCK_WAITING,
  MILESTONE_TOOL_CALL_COMPLETED,
  MILESTONE_TOOL_CALL_STARTED,
} from "@exaix/core";

Deno.test("ExecutionMilestoneSchema - accepts valid minimal milestone", () => {
  const result = ExecutionMilestoneSchema.safeParse({
    milestoneId: crypto.randomUUID(),
    traceId: "trace-abc-123",
    milestoneType: MILESTONE_FLOW_STARTED,
    occurredAt: new Date().toISOString(),
    summary: "Flow started",
  });
  assertEquals(result.success, true);
});

Deno.test("ExecutionMilestoneSchema - accepts all milestone types", () => {
  const types = [
    MILESTONE_FLOW_STARTED,
    MILESTONE_FLOW_STEP_STARTED,
    MILESTONE_FLOW_STEP_COMPLETED,
    MILESTONE_FLOW_STEP_REPLAYED,
    MILESTONE_FLOW_STEP_SKIPPED,
    MILESTONE_LLM_CALL_STARTED,
    MILESTONE_LLM_CALL_COMPLETED,
    MILESTONE_TOOL_CALL_STARTED,
    MILESTONE_TOOL_CALL_COMPLETED,
    MILESTONE_CONTEXT_COMPACTION_APPLIED,
    MILESTONE_APPROVAL_GATE_ENTERED,
    MILESTONE_APPROVAL_GATE_RESOLVED,
    MILESTONE_CHILD_RUN_SPAWNED,
    MILESTONE_CHILD_RUN_COMPLETED,
    MILESTONE_RESOURCE_LOCK_WAITING,
    MILESTONE_RESOURCE_LOCK_ACQUIRED,
    MILESTONE_FLOW_COMPLETED,
    MILESTONE_FLOW_FAILED,
  ];
  for (const milestoneType of types) {
    const result = ExecutionMilestoneSchema.safeParse({
      milestoneId: crypto.randomUUID(),
      traceId: "trace-1",
      milestoneType,
      occurredAt: new Date().toISOString(),
      summary: "Test milestone",
    });
    assertEquals(result.success, true, `type ${milestoneType} should be valid`);
  }
});

Deno.test("ExecutionMilestoneSchema - rejects empty summary", () => {
  const result = ExecutionMilestoneSchema.safeParse({
    milestoneId: crypto.randomUUID(),
    traceId: "trace-1",
    milestoneType: MILESTONE_FLOW_STEP_STARTED,
    occurredAt: new Date().toISOString(),
    summary: "",
  });
  assertEquals(result.success, false);
});

Deno.test("ExecutionMilestoneSchema - rejects summary over 200 chars", () => {
  const result = ExecutionMilestoneSchema.safeParse({
    milestoneId: crypto.randomUUID(),
    traceId: "trace-1",
    milestoneType: MILESTONE_FLOW_STEP_STARTED,
    occurredAt: new Date().toISOString(),
    summary: "x".repeat(201),
  });
  assertEquals(result.success, false);
});

Deno.test("ExecutionMilestoneSchema - rejects non-UUID milestoneId", () => {
  const result = ExecutionMilestoneSchema.safeParse({
    milestoneId: "not-a-uuid",
    traceId: "trace-1",
    milestoneType: MILESTONE_FLOW_STARTED,
    occurredAt: new Date().toISOString(),
    summary: "Flow started",
  });
  assertEquals(result.success, false);
});

Deno.test("ExecutionMilestoneSchema - accepts valid milestone with requiresAttention", () => {
  const result = ExecutionMilestoneSchema.safeParse({
    milestoneId: crypto.randomUUID(),
    traceId: "trace-1",
    milestoneType: MILESTONE_APPROVAL_GATE_ENTERED,
    requiresAttention: true,
    attentionReason: "Operator approval required",
    occurredAt: new Date().toISOString(),
    summary: "Approval gate entered",
  });
  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.data.requiresAttention, true);
    assertEquals(result.data.attentionReason, "Operator approval required");
  }
});

Deno.test("ExecutionMilestoneSchema - defaults requiresAttention to false", () => {
  const result = ExecutionMilestoneSchema.safeParse({
    milestoneId: crypto.randomUUID(),
    traceId: "trace-1",
    milestoneType: MILESTONE_FLOW_STEP_STARTED,
    occurredAt: new Date().toISOString(),
    summary: "Step started",
  });
  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.data.requiresAttention, false);
  }
});

Deno.test("ExecutionMilestoneSchema - accepts progressHint", () => {
  const result = ExecutionMilestoneSchema.safeParse({
    milestoneId: crypto.randomUUID(),
    traceId: "trace-1",
    milestoneType: MILESTONE_FLOW_STEP_COMPLETED,
    occurredAt: new Date().toISOString(),
    summary: "Step 2 of 5 completed",
    progressHint: {
      stepsCompleted: 2,
      stepsTotal: 5,
      currentStepLabel: "Build feature",
    },
  });
  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.data.progressHint?.stepsCompleted, 2);
    assertEquals(result.data.progressHint?.stepsTotal, 5);
    assertEquals(result.data.progressHint?.currentStepLabel, "Build feature");
  }
});

Deno.test("ExecutionMilestoneSchema - rejects invalid milestoneType string", () => {
  const result = ExecutionMilestoneSchema.safeParse({
    milestoneId: crypto.randomUUID(),
    traceId: "trace-1",
    milestoneType: "invalid.type.here",
    occurredAt: new Date().toISOString(),
    summary: "Bad type",
  });
  assertEquals(result.success, false);
});

Deno.test("ExecutionMilestoneSchema - rejects summary with non-printable ASCII", () => {
  const result = ExecutionMilestoneSchema.safeParse({
    milestoneId: crypto.randomUUID(),
    traceId: "trace-1",
    milestoneType: MILESTONE_FLOW_STARTED,
    occurredAt: new Date().toISOString(),
    summary: "Flow started\u0000with null byte",
  });
  assertEquals(result.success, false);
});

Deno.test("ExecutionMilestoneSchema - rejects attentionReason with non-printable ASCII", () => {
  const result = ExecutionMilestoneSchema.safeParse({
    milestoneId: crypto.randomUUID(),
    traceId: "trace-1",
    milestoneType: MILESTONE_APPROVAL_GATE_ENTERED,
    requiresAttention: true,
    attentionReason: "Attention\u0000with null byte",
    occurredAt: new Date().toISOString(),
    summary: "Gate entered",
  });
  assertEquals(result.success, false);
});
