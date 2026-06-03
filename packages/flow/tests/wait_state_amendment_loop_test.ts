/**
 * @module WaitStateAmendmentLoopTest
 * @path packages/flow/tests/wait_state_amendment_loop_test.ts
 * @description Integration tests: amendment creates successor wait; assert original → amended → resumed lifecycle.
 * @architectural-layer Tests
 * @related-files [packages/flow/src/wait_states/wait_state_service.ts]
 */

import { type CreateWaitStateInput, WaitStateService } from "../mod.ts";
import { assertEquals, assertRejects } from "@std/assert";

function makeInput(overrides: Partial<CreateWaitStateInput> = {}): CreateWaitStateInput {
  return {
    kind: "plan_approval",
    traceId: "amendment-trace",
    artifactPath: "Workspace/WaitStates/amendment-trace/ws.json",
    resumeToken: crypto.randomUUID(),
    ...overrides,
  };
}

Deno.test("WaitStateAmendmentLoop: create with amendmentOf auto-transitions original to amended", async () => {
  const svc = new WaitStateService();
  const original = await svc.create(makeInput());
  assertEquals(original.status, "pending");
  assertEquals(original.amendmentOf, undefined);

  const amendment = await svc.create(makeInput({
    kind: "amendment_approval",
    amendmentOf: original.waitStateId,
    traceId: original.traceId,
  }));
  assertEquals(amendment.status, "pending");
  assertEquals(amendment.amendmentOf, original.waitStateId);

  // Original should now be amended
  const fetchedOriginal = await svc.getById(original.waitStateId);
  assertEquals(fetchedOriginal?.status, "amended");
});

Deno.test("WaitStateAmendmentLoop: amending non-existent original throws", async () => {
  const svc = new WaitStateService();
  await assertRejects(
    () =>
      svc.create(makeInput({
        kind: "amendment_approval",
        amendmentOf: crypto.randomUUID(),
      })),
    Error,
    "original wait state not found",
  );
});

Deno.test("WaitStateAmendmentLoop: amending fulfilled/rejected/expired/cancelled original throws", async () => {
  const svc = new WaitStateService();
  const original = await svc.create(makeInput());
  await svc.transition({ waitStateId: original.waitStateId, action: "approve", resumeToken: original.resumeToken });
  const fetched = await svc.getById(original.waitStateId);
  assertEquals(fetched?.status, "fulfilled");

  await assertRejects(
    () =>
      svc.create(makeInput({
        kind: "amendment_approval",
        amendmentOf: original.waitStateId,
      })),
    Error,
    "cannot amend",
  );
});

Deno.test("WaitStateAmendmentLoop: approving amendment auto-resumes the original", async () => {
  const svc = new WaitStateService();
  const original = await svc.create(makeInput());
  const amendment = await svc.create(makeInput({
    kind: "amendment_approval",
    amendmentOf: original.waitStateId,
    traceId: original.traceId,
  }));

  // Approve the amendment
  await svc.transition({ waitStateId: amendment.waitStateId, action: "approve", resumeToken: amendment.resumeToken });

  // Original should now be resumed
  const fetchedOriginal = await svc.getById(original.waitStateId);
  assertEquals(fetchedOriginal?.status, "resumed");

  // Amendment should be fulfilled
  const fetchedAmendment = await svc.getById(amendment.waitStateId);
  assertEquals(fetchedAmendment?.status, "fulfilled");
});

Deno.test("WaitStateAmendmentLoop: resolving amendment via resume also resumes original", async () => {
  const svc = new WaitStateService();
  const original = await svc.create(makeInput());
  const amendment = await svc.create(makeInput({
    kind: "amendment_approval",
    amendmentOf: original.waitStateId,
    traceId: original.traceId,
  }));

  // Resume then approve the amendment
  const resumed = await svc.transition({
    waitStateId: amendment.waitStateId,
    action: "resume",
    resumeToken: amendment.resumeToken,
  });
  assertEquals(resumed.status, "resumed");

  // Original should be resumed
  const fetchedOriginal = await svc.getById(original.waitStateId);
  assertEquals(fetchedOriginal?.status, "resumed");
});

Deno.test("WaitStateAmendmentLoop: approving amendment does NOT resume an already-resumed original again", async () => {
  const svc = new WaitStateService();
  const original = await svc.create(makeInput());

  // Manually resume the original
  await svc.transition({ waitStateId: original.waitStateId, action: "resume", resumeToken: original.resumeToken });

  // Create amendment (original is now resumed, not pending — should throw)
  await assertRejects(
    () =>
      svc.create(makeInput({
        kind: "amendment_approval",
        amendmentOf: original.waitStateId,
      })),
    Error,
    "cannot amend",
  );
});

Deno.test("WaitStateAmendmentLoop: full lifecycle: pending → amended (via amendment) → resumed (via approve amendment)", async () => {
  const svc = new WaitStateService();
  const original = await svc.create(makeInput());
  assertEquals(original.status, "pending");

  // 1 → amended
  const amendment = await svc.create(makeInput({
    kind: "amendment_approval",
    amendmentOf: original.waitStateId,
    traceId: original.traceId,
  }));
  assertEquals((await svc.getById(original.waitStateId))?.status, "amended");

  // 2 → approve amendment → original resumed
  await svc.transition({ waitStateId: amendment.waitStateId, action: "approve", resumeToken: amendment.resumeToken });
  assertEquals((await svc.getById(original.waitStateId))?.status, "resumed");
  assertEquals((await svc.getById(amendment.waitStateId))?.status, "fulfilled");
});
