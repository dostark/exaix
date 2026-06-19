/**
 * @module CrashRecoveryTest
 * @path apps/daemon/tests/crash_recovery_test.ts
 * @description Phase 121 Step 3 — tests for journal-based daemon crash recovery.
 *   Verifies that orphaned session-delegate launches are detected and re-queued
 *   as crash-recovery request files, while completed delegations are skipped.
 */

import { assertEquals, assertExists } from "@std/assert";
import { join } from "@std/path";
import { initTestDbService } from "@exaix/testing";
import { EventLogger } from "@exaix/core/logger";
import { DomainEventType } from "@exaix/core/events";
import type { JSONValue } from "@exaix/core";
import { recoverOrphanedDelegations } from "../src/recovery.ts";

async function makeDb(): ReturnType<typeof initTestDbService> {
  const svc = await initTestDbService();
  return svc;
}

function makeTraceId(): string {
  return crypto.randomUUID();
}

async function seedEvent(
  db: {
    logActivity: (
      actor: string,
      actionType: string,
      target: string | null,
      payload: Record<string, JSONValue>,
      traceId?: string,
    ) => void;
    waitForFlush: () => Promise<void>;
  },
  action: string,
  traceId: string,
  payload: Record<string, JSONValue> = {},
): Promise<void> {
  db.logActivity("system", action, traceId, payload, traceId);
  await db.waitForFlush();
}

Deno.test("[crash_recovery] recovers an orphaned delegation (launched without terminal event)", async () => {
  const { db, cleanup } = await makeDb();
  try {
    const workspaceRoot = await Deno.makeTempDir();
    const logger = new EventLogger({ db });

    const traceId = makeTraceId();
    await seedEvent(db, "session.delegate.launched", traceId, {
      brief: "Test brief content for orphaned delegation",
    });

    const count = await recoverOrphanedDelegations({ db, logger, workspaceRoot });
    assertEquals(count, 1, "must recover 1 orphaned delegation");

    // Assert a request file was created
    const requestFile = join(workspaceRoot, "Workspace", "Requests", `${traceId}_crash_recovery.md`);
    const content = await Deno.readTextFile(requestFile);
    assertExists(content);
    assertEquals(content.includes("Crash-Recovery Request"), true);
    assertEquals(content.includes(traceId), true);

    await Deno.remove(workspaceRoot, { recursive: true });
  } finally {
    await cleanup();
  }
});

Deno.test("[crash_recovery] skips completed delegations (launched + returned)", async () => {
  const { db, cleanup } = await makeDb();
  try {
    const workspaceRoot = await Deno.makeTempDir();
    const logger = new EventLogger({ db });

    const traceId = makeTraceId();
    await seedEvent(db, "session.delegate.launched", traceId);
    await seedEvent(db, "session.delegate.returned", traceId);

    const count = await recoverOrphanedDelegations({ db, logger, workspaceRoot });
    assertEquals(count, 0, "must skip completed delegation");

    await Deno.remove(workspaceRoot, { recursive: true });
  } finally {
    await cleanup();
  }
});

Deno.test("[crash_recovery] returns 0 when no delegation events exist", async () => {
  const { db, cleanup } = await makeDb();
  try {
    const workspaceRoot = await Deno.makeTempDir();
    const logger = new EventLogger({ db });

    const count = await recoverOrphanedDelegations({ db, logger, workspaceRoot });
    assertEquals(count, 0, "must return 0 when no events");

    await Deno.remove(workspaceRoot, { recursive: true });
  } finally {
    await cleanup();
  }
});

Deno.test("[crash_recovery] emits session.delegate.crash_recovered event on recovery", async () => {
  const { db, cleanup } = await makeDb();
  try {
    const workspaceRoot = await Deno.makeTempDir();
    const logger = new EventLogger({ db });

    const traceId = makeTraceId();
    await seedEvent(db, "session.delegate.launched", traceId, {
      brief: "Orphaned brief",
    });

    await recoverOrphanedDelegations({ db, logger, workspaceRoot });
    await db.waitForFlush();
    const events = await db.getActivitiesByTraceSafe(traceId);
    const hasCrashRecovered = events.some((e) => e.action_type === DomainEventType.SessionDelegateCrashRecovered);
    assertEquals(hasCrashRecovered, true, "must emit crash_recovered event");

    await Deno.remove(workspaceRoot, { recursive: true });
  } finally {
    await cleanup();
  }
});
