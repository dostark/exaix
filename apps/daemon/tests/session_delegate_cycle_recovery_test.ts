/**
 * @module SessionDelegateCycleRecoveryTest
 * @path apps/daemon/tests/session_delegate_cycle_recovery_test.ts
 * @description Phase 174 Step 4 recovery-routing tests: a cycle-owned orphaned launch
 *   (`cycle_owned: true`) is routed through its durable claim and never re-queued as a
 *   human-review request, while a legacy (non-cycle) orphan keeps the Phase 121 behavior
 *   unchanged.
 * @architectural-layer Tests
 * @related-files [apps/daemon/src/recovery.ts, packages/session/src/session_delegate_cycle_claim_store.ts]
 */

import { assertEquals } from "@std/assert";
import { initTestDbService } from "@exaix/testing";
import { EventLogger } from "@exaix/core/logger";
import { DomainEventType } from "@exaix/core/events";
import { recoverOrphanedDelegations } from "../src/recovery.ts";
import { SessionDelegateCycleClaimStore } from "@exaix/session/session_delegate_cycle_claim_store.ts";

function makeKey(overrides: { parentTraceId?: string; sequence?: number } = {}) {
  return {
    parentTraceId: overrides.parentTraceId ?? crypto.randomUUID(),
    parentStepId: "next-steps",
    sequence: overrides.sequence ?? 1,
    planDigest: "a".repeat(64),
  };
}

Deno.test("[recovery] a cycle-owned orphan never creates a human-review request", async () => {
  const { db, cleanup } = await initTestDbService();
  try {
    const workspaceRoot = await Deno.makeTempDir();
    const logger = new EventLogger({ db });
    const claimStore = new SessionDelegateCycleClaimStore(db);
    const key = makeKey();
    const delegationTraceId = crypto.randomUUID();
    await claimStore.acquire(key, delegationTraceId);
    await claimStore.transition(key, "launched");

    db.logActivity("system", "session.delegate.launched", delegationTraceId, { cycle_owned: true }, delegationTraceId);
    await db.waitForFlush();

    const count = await recoverOrphanedDelegations({ db, logger, workspaceRoot, claimStore });

    assertEquals(count, 0, "a cycle-owned orphan is never counted as a human-review recovery");
    let requestFileExists = true;
    try {
      await Deno.stat(`${workspaceRoot}/Workspace/Requests/${delegationTraceId}_crash_recovery.md`);
    } catch {
      requestFileExists = false;
    }
    assertEquals(requestFileExists, false, "a cycle-owned orphan must never create a human-review request file");

    const claim = await claimStore.get(key);
    assertEquals(claim?.state, "failed", "the orphaned claim is marked failed so resume/observability can see it");

    await Deno.remove(workspaceRoot, { recursive: true });
  } finally {
    await cleanup();
  }
});

Deno.test("[recovery] a legacy (non-cycle) orphan still creates a human-review request", async () => {
  const { db, cleanup } = await initTestDbService();
  try {
    const workspaceRoot = await Deno.makeTempDir();
    const logger = new EventLogger({ db });
    const claimStore = new SessionDelegateCycleClaimStore(db);
    const traceId = crypto.randomUUID();

    db.logActivity("system", "session.delegate.launched", traceId, { brief: "legacy orphan" }, traceId);
    await db.waitForFlush();

    const count = await recoverOrphanedDelegations({ db, logger, workspaceRoot, claimStore });

    assertEquals(count, 1, "a legacy orphan is still routed to human review");
    const content = await Deno.readTextFile(`${workspaceRoot}/Workspace/Requests/${traceId}_crash_recovery.md`);
    assertEquals(content.includes("Crash-Recovery Request"), true);

    await Deno.remove(workspaceRoot, { recursive: true });
  } finally {
    await cleanup();
  }
});

Deno.test("[recovery] a cycle-owned orphan already reviewed is left alone (not marked failed)", async () => {
  const { db, cleanup } = await initTestDbService();
  try {
    const workspaceRoot = await Deno.makeTempDir();
    const logger = new EventLogger({ db });
    const claimStore = new SessionDelegateCycleClaimStore(db);
    const key = makeKey();
    const delegationTraceId = crypto.randomUUID();
    await claimStore.acquire(key, delegationTraceId);
    await claimStore.transition(key, "launched");
    await claimStore.transition(key, "returned", {
      outcome: {
        delegationTraceId,
        parentTraceId: key.parentTraceId,
        parentStepId: key.parentStepId,
        sequence: key.sequence,
        status: "completed",
        decision: "changes_made",
        summary: "done",
        pathsTouched: ["x.ts"],
      },
    });
    await claimStore.transition(key, "reviewed");

    db.logActivity("system", "session.delegate.launched", delegationTraceId, { cycle_owned: true }, delegationTraceId);
    await db.waitForFlush();

    await recoverOrphanedDelegations({ db, logger, workspaceRoot, claimStore });

    const claim = await claimStore.get(key);
    assertEquals(claim?.state, "reviewed", "an already-terminal reviewed claim must not be overwritten to failed");

    await Deno.remove(workspaceRoot, { recursive: true });
  } finally {
    await cleanup();
  }
});

Deno.test("[recovery] cycle_owned events still emit crash_recovered without leaking a request_path", async () => {
  const { db, cleanup } = await initTestDbService();
  try {
    const workspaceRoot = await Deno.makeTempDir();
    const logger = new EventLogger({ db });
    const traceId = crypto.randomUUID();

    db.logActivity("system", "session.delegate.launched", traceId, { cycle_owned: true }, traceId);
    await db.waitForFlush();

    await recoverOrphanedDelegations({ db, logger, workspaceRoot });
    await db.waitForFlush();

    const event = (await db.getActivitiesByTraceSafe(traceId)).find(
      (item) => item.action_type === DomainEventType.SessionDelegateCrashRecovered,
    );
    assertEquals(event !== undefined, true);
    assertEquals(event!.payload.includes("request_path"), false);

    await Deno.remove(workspaceRoot, { recursive: true });
  } finally {
    await cleanup();
  }
});
