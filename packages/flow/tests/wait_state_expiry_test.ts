/**
 * @module WaitStateExpiryTest
 * @path packages/flow/tests/wait_state_expiry_test.ts
 * @description Integration tests: expiry checks for unattended waits.
 * @architectural-layer Tests
 * @related-files [packages/flow/src/wait_states/wait_state_service.ts]
 */

import { type CreateWaitStateInput, WaitStateService } from "../mod.ts";
import { assertEquals, assertRejects } from "@std/assert";

function makeInput(overrides: Partial<CreateWaitStateInput> = {}): CreateWaitStateInput {
  return {
    kind: "plan_approval",
    traceId: "expiry-trace",
    artifactPath: "Workspace/WaitStates/expiry-trace/ws.json",
    resumeToken: crypto.randomUUID(),
    ...overrides,
  };
}

Deno.test("WaitStateExpiry: getById returns expired when deadlineAt is past", async () => {
  const svc = new WaitStateService();
  const ws = await svc.create(makeInput({ deadlineAt: new Date(Date.now() - 60000).toISOString() }));
  const fetched = await svc.getById(ws.waitStateId);
  assertEquals(fetched?.status, "expired");
});

Deno.test("WaitStateExpiry: getById returns pending when deadlineAt is in the future", async () => {
  const svc = new WaitStateService();
  const ws = await svc.create(makeInput({ deadlineAt: new Date(Date.now() + 86400000).toISOString() }));
  const fetched = await svc.getById(ws.waitStateId);
  assertEquals(fetched?.status, "pending");
});

Deno.test("WaitStateExpiry: getById returns pending when no deadlineAt", async () => {
  const svc = new WaitStateService();
  const ws = await svc.create(makeInput());
  const fetched = await svc.getById(ws.waitStateId);
  assertEquals(fetched?.status, "pending");
});

Deno.test("WaitStateExpiry: getByToken returns expired when deadlineAt is past", async () => {
  const svc = new WaitStateService();
  const ws = await svc.create(makeInput({ deadlineAt: new Date(Date.now() - 60000).toISOString() }));
  const fetched = await svc.getByToken(ws.resumeToken);
  assertEquals(fetched?.status, "expired");
});

Deno.test("WaitStateExpiry: listPending excludes expired wait states", async () => {
  const svc = new WaitStateService();
  await svc.create(makeInput({ traceId: "t1", kind: "plan_approval" }));
  await svc.create(
    makeInput({ traceId: "t1", kind: "review_approval", deadlineAt: new Date(Date.now() - 60000).toISOString() }),
  );

  const pending = await svc.listPending("t1");
  assertEquals(pending.length, 1);
  assertEquals(pending[0].kind, "plan_approval");
});

Deno.test("WaitStateExpiry: transition on expired wait state fails (transition not allowed)", async () => {
  const svc = new WaitStateService();
  const ws = await svc.create(makeInput({ deadlineAt: new Date(Date.now() - 60000).toISOString() }));
  const fetched = await svc.getById(ws.waitStateId);
  assertEquals(fetched?.status, "expired");

  await assertRejects(
    () => svc.transition({ waitStateId: ws.waitStateId, action: "approve", resumeToken: ws.resumeToken }),
    Error,
    "Transition expired → approve is not allowed",
  );
});

Deno.test("WaitStateExpiry: expiry is idempotent — calling getById twice returns expired both times", async () => {
  const svc = new WaitStateService();
  const ws = await svc.create(makeInput({ deadlineAt: new Date(Date.now() - 60000).toISOString() }));
  const first = await svc.getById(ws.waitStateId);
  assertEquals(first?.status, "expired");
  const second = await svc.getById(ws.waitStateId);
  assertEquals(second?.status, "expired");
});
