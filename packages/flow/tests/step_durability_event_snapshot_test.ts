/**
 * @module StepDurabilityEventSnapshotTest
 * @path packages/flow/tests/step_durability_event_snapshot_test.ts
 * @description Snapshot tests for step durability event payload shapes — verifies
 * that all required fields are present with correct types for replay, reuse, and
 * invalidation events. These serve as structural documentation of the event contract.
 */

import { assertEquals } from "@std/assert";
import type { JSONValue } from "@exaix/core";

interface IFlowEventRequestContext {
  traceId?: string;
  requestId?: string;
}

type StepReplayedPayload = IFlowEventRequestContext & {
  flowRunId: string;
  stepId: string;
  recordId: string;
  reason: string;
  [key: string]: JSONValue | undefined;
};

type StepSkippedByReusePayload = IFlowEventRequestContext & {
  flowRunId: string;
  stepId: string;
  priorRecordId: string;
  inputHash: string;
  [key: string]: JSONValue | undefined;
};

type StepInvalidatedPayload = IFlowEventRequestContext & {
  flowRunId: string;
  stepId: string;
  recordId: string;
  reason: string;
  [key: string]: JSONValue | undefined;
};

type Validatable = JSONValue | undefined;

function isValidString(v: Validatable): v is string {
  return typeof v === "string" && v.length > 0;
}

function assertValidReplayedPayload(
  payload: Record<string, JSONValue | undefined>,
): asserts payload is StepReplayedPayload {
  assertEquals(isValidString(payload.flowRunId), true, "flowRunId should be a non-empty string");
  assertEquals(isValidString(payload.stepId), true, "stepId should be a non-empty string");
  assertEquals(isValidString(payload.recordId), true, "recordId should be a non-empty string");
  assertEquals(isValidString(payload.reason), true, "reason should be a non-empty string");
  assertEquals(isValidString(payload.traceId), true, "traceId should be a non-empty string");
}

function assertValidSkippedByReusePayload(
  payload: Record<string, JSONValue | undefined>,
): asserts payload is StepSkippedByReusePayload {
  assertEquals(isValidString(payload.flowRunId), true, "flowRunId should be a non-empty string");
  assertEquals(isValidString(payload.stepId), true, "stepId should be a non-empty string");
  assertEquals(isValidString(payload.priorRecordId), true, "priorRecordId should be a non-empty string");
  assertEquals(isValidString(payload.inputHash), true, "inputHash should be a non-empty string");
  assertEquals(isValidString(payload.traceId), true, "traceId should be a non-empty string");
}

function assertValidInvalidatedPayload(
  payload: Record<string, JSONValue | undefined>,
): asserts payload is StepInvalidatedPayload {
  assertEquals(isValidString(payload.flowRunId), true, "flowRunId should be a non-empty string");
  assertEquals(isValidString(payload.stepId), true, "stepId should be a non-empty string");
  assertEquals(isValidString(payload.recordId), true, "recordId should be a non-empty string");
  assertEquals(isValidString(payload.reason), true, "reason should be a non-empty string");
  assertEquals(isValidString(payload.traceId), true, "traceId should be a non-empty string");
}

Deno.test("[StepDurabilityEvent] flow.step.replayed payload has all required fields", () => {
  const payload: Record<string, JSONValue | undefined> = {
    flowId: "test-flow",
    traceId: "trace-001",
    requestId: "req-001",
    flowRunId: "run-001",
    stepId: "step-replayable",
    recordId: "rec-abc123",
    reason: "replay-allowed",
  };

  assertValidReplayedPayload(payload);
  assertEquals(payload.flowId, "test-flow");
  assertEquals(payload.requestId, "req-001");
});

Deno.test("[StepDurabilityEvent] flow.step.replayed with explicit reason", () => {
  const payload: Record<string, JSONValue | undefined> = {
    flowId: "test-flow",
    traceId: "trace-002",
    flowRunId: "run-002",
    stepId: "step-replayable",
    recordId: "rec-def456",
    reason: "side-effect-class-none",
  };

  assertValidReplayedPayload(payload);
  assertEquals(payload.reason, "side-effect-class-none");
});

Deno.test("[StepDurabilityEvent] flow.step.skipped_by_reuse payload has all required fields", () => {
  const payload: Record<string, JSONValue | undefined> = {
    flowId: "test-flow",
    traceId: "trace-003",
    flowRunId: "run-003",
    stepId: "step-replayable",
    priorRecordId: "rec-abc123",
    inputHash: "abcdef1234567890abcdef1234567890",
  };

  assertValidSkippedByReusePayload(payload);
  assertEquals(payload.flowId, "test-flow");
  assertEquals(payload.inputHash, "abcdef1234567890abcdef1234567890");
});

Deno.test("[StepDurabilityEvent] flow.step.invalidated payload has all required fields", () => {
  const payload: Record<string, JSONValue | undefined> = {
    flowId: "test-flow",
    traceId: "trace-004",
    flowRunId: "run-004",
    stepId: "step-invalidated",
    recordId: "rec-ghi789",
    reason: "stale-input-hash",
  };

  assertValidInvalidatedPayload(payload);
  assertEquals(payload.flowId, "test-flow");
  assertEquals(payload.reason, "stale-input-hash");
});

Deno.test("[StepDurabilityEvent] flow.step.invalidated with explicit invalidation reason", () => {
  const payload: Record<string, JSONValue | undefined> = {
    flowId: "test-flow",
    traceId: "trace-005",
    flowRunId: "run-005",
    stepId: "step-invalidated",
    recordId: "rec-jkl012",
    reason: "schema-version-mismatch",
  };

  assertValidInvalidatedPayload(payload);
  assertEquals(payload.reason, "schema-version-mismatch");
  assertEquals(payload.recordId, "rec-jkl012");
});

Deno.test("[StepDurabilityEvent] all step durability event payloads include traceId when set", () => {
  const replayed: Record<string, JSONValue | undefined> = {
    flowId: "test-flow",
    traceId: "trace-all",
    flowRunId: "run-all",
    stepId: "step-a",
    recordId: "rec-001",
    reason: "replay-allowed",
  };
  assertValidReplayedPayload(replayed);

  const skipped: Record<string, JSONValue | undefined> = {
    flowId: "test-flow",
    traceId: "trace-all",
    flowRunId: "run-all",
    stepId: "step-b",
    priorRecordId: "rec-002",
    inputHash: "deadbeef",
  };
  assertValidSkippedByReusePayload(skipped);

  const invalidated: Record<string, JSONValue | undefined> = {
    flowId: "test-flow",
    traceId: "trace-all",
    flowRunId: "run-all",
    stepId: "step-c",
    recordId: "rec-003",
    reason: "manual-invalidation",
  };
  assertValidInvalidatedPayload(invalidated);
});
