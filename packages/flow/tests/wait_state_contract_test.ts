/**
 * @module WaitStateContractTest
 * @path packages/flow/tests/wait_state_contract_test.ts
 * @description Tests for wait-state schemas, transition policy, and service contracts.
 */

import { assertEquals, assertRejects } from "@std/assert";
import {
  CreateWaitStateInputSchema,
  DefaultWaitStateTransitionPolicy,
  TransitionWaitStateInputSchema,
  WaitStateSchema,
  WaitStateService,
  WaitStateStatusSchema,
} from "@exaix/flow";
import type { IWaitState } from "@exaix/flow";
import { FLOW_EVENT_WAIT_CREATED, FLOW_EVENT_WAIT_PENDING } from "@exaix/core";

function validWaitState(overrides?: Partial<IWaitState>): IWaitState {
  return {
    waitStateId: "00000000-0000-4000-8000-000000000001",
    traceId: "trace-1",
    kind: "plan_approval",
    status: "pending",
    artifactPath: "Workspace/WaitStates/trace-1/00000000-0000-4000-8000-000000000001.json",
    createdAt: "2026-06-03T00:00:00.000Z",
    updatedAt: "2026-06-03T00:00:00.000Z",
    resumeToken: "00000000-0000-4000-8000-000000000002",
    metadata: {},
    ...overrides,
  };
}

Deno.test("WaitStateSchema rejects empty waitStateId", () => {
  const result = WaitStateSchema.safeParse(validWaitState({ waitStateId: "" }));
  assertEquals(result.success, false);
});

Deno.test("WaitStateSchema rejects invalid resumeToken (non-uuid)", () => {
  const result = WaitStateSchema.safeParse(validWaitState({ resumeToken: "too-short" }));
  assertEquals(result.success, false);
});

Deno.test("WaitStateSchema rejects invalid status", () => {
  const result = WaitStateSchema.safeParse(validWaitState({ status: "invalid_status" as never }));
  assertEquals(result.success, false);
});

Deno.test("WaitStateSchema rejects invalid kind", () => {
  const result = WaitStateSchema.safeParse(validWaitState({ kind: "invalid_kind" as never }));
  assertEquals(result.success, false);
});

Deno.test("WaitStateSchema accepts any deadlineAt (validation moved to service layer)", () => {
  const result = WaitStateSchema.safeParse(validWaitState({
    deadlineAt: "2020-01-01T00:00:00.000Z",
  }));
  assertEquals(result.success, true);
});

Deno.test("WaitStateSchema accepts valid wait state", () => {
  const result = WaitStateSchema.safeParse(validWaitState());
  assertEquals(result.success, true);
});

Deno.test("CreateWaitStateInputSchema requires kind, traceId, artifactPath", () => {
  const result = CreateWaitStateInputSchema.safeParse({
    kind: "plan_approval",
    traceId: "trace-1",
    artifactPath: "Workspace/WaitStates/trace-1/test.json",
    resumeToken: "00000000-0000-4000-8000-000000000002",
  });
  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.data.resumeToken, "00000000-0000-4000-8000-000000000002");
  }
});

Deno.test("CreateWaitStateInputSchema rejects missing required fields", () => {
  const result = CreateWaitStateInputSchema.safeParse({});
  assertEquals(result.success, false);
});

Deno.test("TransitionWaitStateInputSchema requires waitStateId, action, resumeToken", () => {
  const valid = TransitionWaitStateInputSchema.safeParse({
    waitStateId: "00000000-0000-4000-8000-000000000001",
    action: "approve",
    resumeToken: "00000000-0000-4000-8000-000000000002",
  });
  assertEquals(valid.success, true);

  const invalid = TransitionWaitStateInputSchema.safeParse({
    waitStateId: "not-a-uuid",
    action: "unknown_action",
  });
  assertEquals(invalid.success, false);
});

Deno.test("WaitStateStatusSchema has all required values", () => {
  const statuses = WaitStateStatusSchema.options;
  assertEquals(statuses.includes("pending"), true);
  assertEquals(statuses.includes("resumed"), true);
  assertEquals(statuses.includes("fulfilled"), true);
  assertEquals(statuses.includes("rejected"), true);
  assertEquals(statuses.includes("amended"), true);
  assertEquals(statuses.includes("expired"), true);
  assertEquals(statuses.includes("cancelled"), true);
});

Deno.test("DefaultWaitStateTransitionPolicy: pending allows all transitions", () => {
  const policy = new DefaultWaitStateTransitionPolicy();
  const pending: IWaitState = validWaitState();

  for (const action of ["resume", "approve", "reject", "amend", "expire", "cancel"] as const) {
    const result = policy.validate({ current: pending, action });
    assertEquals(result.allowed, true, `pending → ${action} should be allowed`);
  }
});

Deno.test("DefaultWaitStateTransitionPolicy: fulfilled rejects all transitions", () => {
  const policy = new DefaultWaitStateTransitionPolicy();
  const fulfilled: IWaitState = validWaitState({ status: "fulfilled" });

  for (const action of ["resume", "approve", "reject", "amend", "expire", "cancel"] as const) {
    const result = policy.validate({ current: fulfilled, action });
    assertEquals(result.allowed, false, `fulfilled → ${action} should be denied`);
  }
});

Deno.test("DefaultWaitStateTransitionPolicy: expired rejects all transitions", () => {
  const policy = new DefaultWaitStateTransitionPolicy();
  const expired: IWaitState = validWaitState({ status: "expired" });

  for (const action of ["resume", "approve", "reject", "amend", "expire", "cancel"] as const) {
    const result = policy.validate({ current: expired, action });
    assertEquals(result.allowed, false, `expired → ${action} should be denied`);
  }
});

Deno.test("DefaultWaitStateTransitionPolicy: cancelled rejects all transitions", () => {
  const policy = new DefaultWaitStateTransitionPolicy();
  const cancelled: IWaitState = validWaitState({ status: "cancelled" });

  for (const action of ["resume", "approve", "reject", "amend", "expire", "cancel"] as const) {
    const result = policy.validate({ current: cancelled, action });
    assertEquals(result.allowed, false, `cancelled → ${action} should be denied`);
  }
});

Deno.test("DefaultWaitStateTransitionPolicy: resumed only allows approve/fulfill", () => {
  const policy = new DefaultWaitStateTransitionPolicy();
  const resumed: IWaitState = validWaitState({ status: "resumed" });

  const approveResult = policy.validate({ current: resumed, action: "approve" });
  assertEquals(approveResult.allowed, true, "resumed → approve should be allowed");

  const rejectResult = policy.validate({ current: resumed, action: "reject" });
  assertEquals(rejectResult.allowed, false, "resumed → reject should be denied");
});

Deno.test("DefaultWaitStateTransitionPolicy: amended allows only resume/approve/reject", () => {
  const policy = new DefaultWaitStateTransitionPolicy();
  const amended: IWaitState = validWaitState({ status: "amended" });

  for (const action of ["resume", "approve", "reject"] as const) {
    const result = policy.validate({ current: amended, action });
    assertEquals(result.allowed, true, `amended → ${action} should be allowed`);
  }

  for (const action of ["amend", "expire", "cancel"] as const) {
    const result = policy.validate({ current: amended, action });
    assertEquals(result.allowed, false, `amended → ${action} should be denied`);
  }
});

Deno.test("DefaultWaitStateTransitionPolicy: rejected rejects all transitions", () => {
  const policy = new DefaultWaitStateTransitionPolicy();
  const rejected: IWaitState = validWaitState({ status: "rejected" });

  for (const action of ["resume", "approve", "reject", "amend", "expire", "cancel"] as const) {
    const result = policy.validate({ current: rejected, action });
    assertEquals(result.allowed, false, `rejected → ${action} should be denied`);
  }
});

Deno.test("FLOW_EVENT_WAIT_CREATED constant matches expected value", () => {
  assertEquals(FLOW_EVENT_WAIT_CREATED, "flow.wait.created");
});

Deno.test("FLOW_EVENT_WAIT_PENDING constant matches expected value", () => {
  assertEquals(FLOW_EVENT_WAIT_PENDING, "flow.wait.pending");
});

Deno.test("daemon onClarificationCreated: raw object is valid WaitStateSchema", () => {
  const waitStateId = "00000000-0000-4000-8000-000000000099";
  const resumeToken = "00000000-0000-4000-8000-000000000088";
  const traceId = "trace-daemon-test";
  const now = new Date().toISOString();
  const raw = {
    waitStateId,
    traceId,
    kind: "clarification",
    status: "pending",
    artifactPath: `Workspace/WaitStates/${traceId}/${waitStateId}.json`,
    resumeToken,
    createdAt: now,
    updatedAt: now,
    metadata: {},
  };
  const result = WaitStateSchema.safeParse(raw);
  assertEquals(result.success, true, "daemon clarification object must satisfy WaitStateSchema");
});

Deno.test("WaitStateService reject transition on non-existent wait state", async () => {
  const service = new WaitStateService();

  await assertRejects(
    () =>
      service.transition({
        waitStateId: "00000000-0000-4000-8000-000000009999",
        action: "approve",
        resumeToken: "00000000-0000-4000-8000-000000000002",
      }),
    Error,
    "not found",
  );
});

Deno.test("WaitStateService reject duplicate waitStateId on create", async () => {
  const service = new WaitStateService();
  const id = "00000000-0000-4000-8000-000000000005";

  await service.create({
    kind: "plan_approval",
    traceId: "trace-1",
    artifactPath: `Workspace/WaitStates/trace-1/${id}.json`,
    resumeToken: "00000000-0000-4000-8000-000000000006",
  });

  await assertRejects(
    () =>
      service.create({
        kind: "plan_approval",
        traceId: "trace-1",
        artifactPath: `Workspace/WaitStates/trace-1/${id}.json`,
        resumeToken: "00000000-0000-4000-8000-000000000007",
      }),
    Error,
    "already exists",
  );
});

Deno.test("WaitStateService getById returns null for non-existent", async () => {
  const service = new WaitStateService();
  const result = await service.getById("00000000-0000-4000-8000-000000009999");
  assertEquals(result, null);
});

Deno.test("WaitStateService listPending returns only pending waits", async () => {
  const service = new WaitStateService();

  const id1 = await service.create({
    kind: "plan_approval",
    traceId: "trace-list-a",
    artifactPath: "Workspace/WaitStates/trace-list-a/1.json",
    resumeToken: "00000000-0000-4000-8000-000000000011",
  });
  const id2 = await service.create({
    kind: "review_approval",
    traceId: "trace-list-b",
    artifactPath: "Workspace/WaitStates/trace-list-b/2.json",
    resumeToken: "00000000-0000-4000-8000-000000000012",
  });

  await service.transition({
    waitStateId: id1.waitStateId,
    action: "approve",
    resumeToken: "00000000-0000-4000-8000-000000000011",
  });

  const pending = await service.listPending();
  assertEquals(pending.length, 1);
  assertEquals(pending[0].waitStateId, id2.waitStateId);
});

Deno.test("WaitStateService full lifecycle: create → approve → getById reflects fulfilled", async () => {
  const service = new WaitStateService();
  const resumeToken = "00000000-0000-4000-8000-000000000021";

  const created = await service.create({
    kind: "review_approval",
    traceId: "trace-lifecycle",
    artifactPath: "Workspace/WaitStates/trace-lifecycle/lc.json",
    resumeToken,
  });
  assertEquals(created.status, "pending");

  const transitioned = await service.transition({
    waitStateId: created.waitStateId,
    action: "approve",
    resumeToken,
    resolutionSummary: "Approved by reviewer",
  });
  assertEquals(transitioned.status, "fulfilled");

  const fetched = await service.getById(created.waitStateId);
  assertEquals(fetched?.status, "fulfilled");
  assertEquals(fetched?.resolutionSummary, "Approved by reviewer");
});
