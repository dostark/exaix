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
import { SessionBriefReader } from "@exaix/session/session_brief_reader.ts";
import { SessionBriefSchema } from "@exaix/schemas/session_delegate.ts";

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

Deno.test("[crash_recovery][security] redacted launch payload recovers from brief without leaking host paths", async () => {
  const { db, cleanup } = await makeDb();
  const workspaceRoot = await Deno.makeTempDir();
  const sessionDir = await Deno.makeTempDir();
  try {
    const logger = new EventLogger({ db });
    const traceId = makeTraceId();
    const traceDir = join(sessionDir, traceId);
    await Deno.mkdir(traceDir, { recursive: true });
    await Deno.writeTextFile(
      join(traceDir, "brief.json"),
      JSON.stringify(SessionBriefSchema.parse({
        trace_id: traceId,
        agent_role: "test-identity",
        gate: "code_changes",
        tool: "codex",
        objective: "Validated recovery objective",
        artifact_ref: ".exa/PlanContext/phase-174.md",
        permitted_paths: ["packages/**"],
        token_budget: { max_input_tokens: 1, max_output_tokens: 1, max_total_tokens: 2 },
        resume_token: "must-not-be-journaled",
        deadline: "2026-12-31T00:00:00.000Z",
      })),
    );
    await seedEvent(db, DomainEventType.SessionDelegateLaunched, traceId, {
      gate: "code_changes",
      tool: "codex",
      artifact_ref: ".exa/PlanContext/phase-174.md",
    });

    const count = await recoverOrphanedDelegations({
      db,
      logger,
      workspaceRoot,
      briefReader: new SessionBriefReader(sessionDir),
    });
    assertEquals(count, 1);
    const request = await Deno.readTextFile(
      join(workspaceRoot, "Workspace", "Requests", `${traceId}_crash_recovery.md`),
    );
    assertEquals(request.includes("Validated recovery objective"), true);

    await db.waitForFlush();
    const event = (await db.getActivitiesByTraceSafe(traceId)).find(
      (item) => item.action_type === DomainEventType.SessionDelegateCrashRecovered,
    );
    assertExists(event);
    assertEquals(event!.payload.includes(workspaceRoot), false);
    assertEquals(event!.payload.includes("must-not-be-journaled"), false);
  } finally {
    await Deno.remove(workspaceRoot, { recursive: true });
    await Deno.remove(sessionDir, { recursive: true });
    await cleanup();
  }
});
