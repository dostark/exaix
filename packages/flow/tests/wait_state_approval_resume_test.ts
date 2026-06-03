/**
 * @module WaitStateApprovalResumeTest
 * @path packages/flow/tests/wait_state_approval_resume_test.ts
 * @description Integration tests: flow with a plan_approval wait state; resume via token; assert no upstream recomputation.
 *              Tests the WaitStateService contract — in-memory service simulating flow-runner integration.
 * @architectural-layer Tests
 * @related-files [packages/flow/src/wait_states/wait_state_service.ts]
 */

import { type CreateWaitStateInput, WaitStateService } from "../mod.ts";
import { assertEquals, assertRejects } from "@std/assert";

function makeCreateInput(overrides: Partial<CreateWaitStateInput> = {}): CreateWaitStateInput {
  return {
    kind: "plan_approval",
    traceId: "trace-1",
    artifactPath: "Workspace/WaitStates/trace-1/ws-1.json",
    resumeToken: crypto.randomUUID(),
    ...overrides,
  };
}

Deno.test("WaitStateApprovalResume: create wait state returns pending status", async () => {
  const svc = new WaitStateService();
  const ws = await svc.create(makeCreateInput());
  assertEquals(ws.status, "pending");
  assertEquals(ws.kind, "plan_approval");
});

Deno.test("WaitStateApprovalResume: approve transitions to fulfilled", async () => {
  const svc = new WaitStateService();
  const ws = await svc.create(makeCreateInput());
  const transitioned = await svc.transition({
    waitStateId: ws.waitStateId,
    action: "approve",
    resumeToken: ws.resumeToken,
  });
  assertEquals(transitioned.status, "fulfilled");
});

Deno.test("WaitStateApprovalResume: reject transitions to rejected", async () => {
  const svc = new WaitStateService();
  const ws = await svc.create(makeCreateInput());
  const transitioned = await svc.transition({
    waitStateId: ws.waitStateId,
    action: "reject",
    resumeToken: ws.resumeToken,
  });
  assertEquals(transitioned.status, "rejected");
});

Deno.test("WaitStateApprovalResume: resume on pending transitions to resumed, then approve to fulfilled", async () => {
  const svc = new WaitStateService();
  const ws = await svc.create(makeCreateInput());

  const resumed = await svc.transition({
    waitStateId: ws.waitStateId,
    action: "resume",
    resumeToken: ws.resumeToken,
  });
  assertEquals(resumed.status, "resumed");

  const fulfilled = await svc.transition({
    waitStateId: ws.waitStateId,
    action: "approve",
    resumeToken: ws.resumeToken,
  });
  assertEquals(fulfilled.status, "fulfilled");
});

Deno.test("WaitStateApprovalResume: getByToken returns the wait state", async () => {
  const svc = new WaitStateService();
  const input = makeCreateInput();
  const ws = await svc.create(input);
  const found = await svc.getByToken(ws.resumeToken);
  assertEquals(found?.waitStateId, ws.waitStateId);
  assertEquals(found?.status, "pending");
});

Deno.test("WaitStateApprovalResume: getById returns null for non-existent", async () => {
  const svc = new WaitStateService();
  const result = await svc.getById(crypto.randomUUID());
  assertEquals(result, null);
});

Deno.test("WaitStateApprovalResume: getByToken returns null for unknown token", async () => {
  const svc = new WaitStateService();
  const result = await svc.getByToken(crypto.randomUUID());
  assertEquals(result, null);
});

Deno.test("WaitStateApprovalResume: transition rejects wrong resume token", async () => {
  const svc = new WaitStateService();
  const ws = await svc.create(makeCreateInput());
  await assertRejects(
    () =>
      svc.transition({
        waitStateId: ws.waitStateId,
        action: "approve",
        resumeToken: crypto.randomUUID(),
      }),
    Error,
    "resume token mismatch",
  );
});

Deno.test("WaitStateApprovalResume: transition rejects non-existent wait state", async () => {
  const svc = new WaitStateService();
  await assertRejects(
    () =>
      svc.transition({
        waitStateId: crypto.randomUUID(),
        action: "approve",
        resumeToken: crypto.randomUUID(),
      }),
    Error,
    "wait state not found",
  );
});

Deno.test("WaitStateApprovalResume: listPending returns only pending waits for a traceId", async () => {
  const svc = new WaitStateService();
  await svc.create(makeCreateInput({ traceId: "trace-A", kind: "plan_approval" }));
  await svc.create(makeCreateInput({ traceId: "trace-A", kind: "review_approval" }));
  await svc.create(makeCreateInput({ traceId: "trace-B", kind: "clarification" }));

  const traceA = await svc.listPending("trace-A");
  assertEquals(traceA.length, 2);
  assertEquals(traceA.every((w) => w.traceId === "trace-A"), true);

  const traceB = await svc.listPending("trace-B");
  assertEquals(traceB.length, 1);
});

Deno.test("WaitStateApprovalResume: no upstream recomputation — same state returned after resume", async () => {
  const svc = new WaitStateService();
  const ws = await svc.create(makeCreateInput());
  const originalUpdatedAt = ws.updatedAt;

  // Simulate resume: transition to resumed
  const resumed = await svc.transition({
    waitStateId: ws.waitStateId,
    action: "resume",
    resumeToken: ws.resumeToken,
  });
  assertEquals(resumed.status, "resumed");
  // updatedAt changes because state changed
  assertEquals(resumed.updatedAt >= originalUpdatedAt, true);

  // getById returns the same resumed state (no recomputation)
  const fetched = await svc.getById(ws.waitStateId);
  assertEquals(fetched?.status, "resumed");
  assertEquals(fetched?.updatedAt, resumed.updatedAt);
});

Deno.test("WaitStateApprovalResume: create rejects duplicate pending same traceId+kind", async () => {
  const svc = new WaitStateService();
  await svc.create(makeCreateInput({ traceId: "dup-trace", kind: "plan_approval" }));
  await assertRejects(
    () => svc.create(makeCreateInput({ traceId: "dup-trace", kind: "plan_approval" })),
    Error,
    "wait state already exists",
  );
});

Deno.test("WaitStateApprovalResume: create allows same traceId+kind after previous is fulfilled", async () => {
  const svc = new WaitStateService();
  const first = await svc.create(makeCreateInput({ traceId: "t2", kind: "plan_approval" }));
  await svc.transition({ waitStateId: first.waitStateId, action: "approve", resumeToken: first.resumeToken });
  const second = await svc.create(makeCreateInput({ traceId: "t2", kind: "plan_approval" }));
  assertEquals(second.status, "pending");
});
