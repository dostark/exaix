/**
 * @module DBJournalTest
 * @path tests/services/database/db_journal_test.ts
 * @description Specialized tests for DatabaseService's activity journaling, verifying complex
 * query filters (trace_id, identity_id, action_type), sort ordering, and asynchronous flush behavior.
 */

import { assertEquals } from "@std/assert";
import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { initTestDbService } from "../../helpers/db.ts";

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
    assertEquals(results[0].identity_id, "agent-2"); // trace-2 (newer)
    assertEquals(results[1].identity_id, "agent-1"); // trace-1 (older)
  });

  it("should filter by identity_id", async () => {
    const results = await db.queryActivity({ identityId: "agent-1" });
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
});
