/**
 * @module DBJournalTest
 * @path packages/storage-sqlite/tests/db_journal_test.ts
 * @description Specialized tests for DatabaseService's activity journaling, verifying complex
 * query filters (trace_id,.agent_role, action_type), sort ordering, and asynchronous flush behavior.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { initTestDbService } from "@exaix/testing";

type ITestDb = Awaited<ReturnType<typeof initTestDbService>>["db"];

describe("DatabaseService - Journal Queries", () => {
  let db: Awaited<ReturnType<typeof initTestDbService>>["db"];
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    const testDb = await initTestDbService();
    db = testDb.db;
    cleanup = testDb.cleanup;

    // Seed test data
    // We add small delays to ensure distinct timestamps for sorting verification
    await seedActivity(db, "a", "request.created", "agent-1", "trace-1");
    await new Promise((r) => setTimeout(r, 10));
    await seedActivity(db, "b", "plan.created", "agent-1", "trace-1");
    await new Promise((r) => setTimeout(r, 10));
    await seedActivity(db, "c", "plan.approved", "user", "trace-1");
    await new Promise((r) => setTimeout(r, 10));
    await seedActivity(db, "d", "request.created", "agent-2", "trace-2");
    await new Promise((r) => setTimeout(r, 10));
    await seedActivity(db, "e", "error", "agent-1", "trace-3"); // Older error

    await db.waitForFlush();
  });

  afterEach(async () => {
    await cleanup();
  });

  async function seedActivity(db: ITestDb, actor: string, actionType: string, identityId: string, traceId: string) {
    await db.logActivity(actor, actionType, "target", { foo: "bar" }, traceId, null, identityId);
  }

  it("should query all activities with default limit", async () => {
    const results = await db.queryActivity({});
    assertEquals(results.length, 5);
    // Should be ordered by timestamp DESC (newest first)
    assertEquals(results[0].action_type, "error");
    assertEquals(results[4].action_type, "request.created");
  });

  it("should filter by limit", async () => {
    const results = await db.queryActivity({ limit: 2 });
    assertEquals(results.length, 2);
    // Newest 2
    assertEquals(results[0].action_type, "error");
    assertEquals(results[1].action_type, "request.created");
  });

  it("should filter by trace_id", async () => {
    const results = await db.queryActivity({ traceId: "trace-1" });
    assertEquals(results.length, 3);
    assertEquals(results[0].trace_id, "trace-1");
  });

  it("should filter by action_type", async () => {
    const results = await db.queryActivity({ actionType: "request.created" });
    assertEquals(results.length, 2);
    // Sort check
    assertEquals(results[0].agent_role, "agent-2"); // trace-2 (newer)
    assertEquals(results[1].agent_role, "agent-1"); // trace-1 (older)
  });

  it("should filter by.agent_role", async () => {
    const results = await db.queryActivity({ agentRole: "agent-1" });
    assertEquals(results.length, 3); // trace-1: request, plan.created; trace-3: error
    // Filter out user actions
    const userAction = results.find((r) => r.actor === "user");
    assertEquals(userAction, undefined);
  });

  it("should combine filters (AND logic)", async () => {
    const results = await db.queryActivity({
      identityId: "agent-1",
      actionType: "request.created",
    });
    assertEquals(results.length, 1);
    assertEquals(results[0].trace_id, "trace-1");
  });

  it("should return empty array when no matches", async () => {
    const results = await db.queryActivity({ traceId: "non-existent" });
    assertEquals(results.length, 0);
  });

  it("security: rejects a distinct field that is not an activity column (Finding 12)", async () => {
    // A non-column distinct value must be rejected by an allowlist check before it can
    // be interpolated into SQL — not merely error at the SQLite layer.
    const error = await db.queryActivity({ distinct: "id); DROP TABLE activity; --" })
      .then(() => null)
      .catch((e) => e);
    assert(error instanceof Error, "malicious distinct field must be rejected");
    assertStringIncludes(error.message, "Invalid distinct field");

    // The table is intact and still queryable.
    const results = await db.queryActivity({});
    assertEquals(results.length, 5);
  });
});
