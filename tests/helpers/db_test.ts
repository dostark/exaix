/**
 * @module DatabaseServiceTest
 * @path tests/db_test.ts
 * @description Tests for DatabaseService activity journal storage functionality.
 */

import { assert, assertEquals, assertExists } from "@std/assert";
import { MemoryBankSource } from "../src/shared/enums.ts";

import { initActivityTableSchema, initTestDbService } from "./helpers/db.ts";
import { DatabaseService } from "../src/services/db.ts";
import { createMockConfig } from "./helpers/config.ts";

/**
 * Tests for DatabaseService (Activity Journal Storage)
 *
 * Success Criteria:
 * - Test 1: Initializes SQLite database with correct schema
 * - Test 2: Logs single activity with all required fields
 * - Test 3: Batches multiple activities for efficient writes
 * - Test 4: Flushes batch when max size reached
 * - Test 5: Prevents logging when database is closing
 * - Test 6: Query methods return filtered/limited results
 * - Test 7: Handles null fields (identity_id, target) gracefully
 * - Test 8: Auto-generates trace_id if not provided
 * - Test 9: Data persists across database connections
 */

Deno.test("DatabaseService: initializes with configuration", async () => {
  const { db, cleanup } = await initTestDbService();
  try {
    assertExists(db.instance);
    assertEquals(db.instance.constructor.name, "Database");

    await db.close();
  } finally {
    await cleanup();
  }
});

Deno.test("DatabaseService: logs single activity", async () => {
  const { db, cleanup } = await initTestDbService();
  try {
    const traceId = crypto.randomUUID();
    db.logActivity(MemoryBankSource.USER, "test.action", "target", { foo: "bar" }, traceId);

    await db.waitForFlush();

    const activities = db.getActivitiesByTrace(traceId);
    assertEquals(activities.length, 1);
    assertEquals(activities[0].actor, MemoryBankSource.USER);
    assertEquals(activities[0].action_type, "test.action");
    assertEquals(activities[0].target, "target");
    assertEquals(JSON.parse(activities[0].payload).foo, "bar");

    await db.close();
  } finally {
    await cleanup();
  }
});

Deno.test("DatabaseService: batches multiple activities", async () => {
  const { db, cleanup } = await initTestDbService();
  try {
    const traceId = crypto.randomUUID();

    // Log multiple activities
    for (let i = 0; i < 5; i++) {
      db.logActivity(MemoryBankSource.USER, "test.action", `target-${i}`, { index: i }, traceId);
    }

    await db.waitForFlush();

    const activities = db.getActivitiesByTrace(traceId);
    assertEquals(activities.length, 5);
    assertEquals(activities[0].target, "target-0");
    assertEquals(activities[4].target, "target-4");

    await db.close();
  } finally {
    await cleanup();
  }
});

Deno.test("DatabaseService: flushes when max batch size reached", async () => {
  const { db, cleanup } = await initTestDbService();
  try {
    // Default max batch is 100

    const traceId = crypto.randomUUID();

    // Log exactly MAX_BATCH_SIZE activities
    for (let i = 0; i < 100; i++) {
      db.logActivity(MemoryBankSource.USER, "test.action", `target-${i}`, { index: i }, traceId);
    }

    // Should auto-flush at 100, no need to wait long
    await new Promise((resolve) => setTimeout(resolve, 50));

    const activities = db.getActivitiesByTrace(traceId);
    assertEquals(activities.length, 100);

    await db.close();
  } finally {
    await cleanup();
  }
});

Deno.test("DatabaseService: handles waitForFlush with empty queue", async () => {
  const { db, cleanup } = await initTestDbService();
  try {
    // Should return immediately
    await db.waitForFlush();

    await db.close();
  } finally {
    await cleanup();
  }
});

Deno.test("DatabaseService: prevents logging when closing", async () => {
  const { db, cleanup } = await initTestDbService();
  try {
    const traceId = crypto.randomUUID();
    db.logActivity(MemoryBankSource.USER, "test.before", "target", { test: 1 }, traceId);

    await db.waitForFlush();

    // Start closing
    const originalWarn = console.warn;
    let warnCalled = false;
    console.warn = () => {
      warnCalled = true;
    };

    // Close and try to log
    await db.close();
    db.logActivity(MemoryBankSource.USER, "test.after", "target", { test: 2 }, traceId);

    console.warn = originalWarn;

    // Should have warned about logging during close
    assertEquals(warnCalled, true);

    // Only the first activity should be logged
    // Note: Can't query after close, so this test verifies the warning
  } finally {
    await cleanup();
  }
});

Deno.test("DatabaseService: flushes pending logs on close", async () => {
  const { db, tempDir, cleanup: _cleanup } = await initTestDbService();
  try {
    const traceId = crypto.randomUUID();

    // Log activities
    db.logActivity(MemoryBankSource.USER, "test.action1", "target", { test: 1 }, traceId);
    db.logActivity(MemoryBankSource.USER, "test.action2", "target", { test: 2 }, traceId);

    // Don't wait for flush, close immediately
    await db.close();

    // Create new connection to verify data was flushed
    const config2 = createMockConfig(tempDir);
    const db2 = new DatabaseService(config2);
    // Initialize schema for second connection
    initActivityTableSchema(db2);

    const activities = db2.getActivitiesByTrace(traceId);
    assertEquals(activities.length, 2);

    await db2.close();
  } finally {
    // Note: cleanup() closes db, but db is already closed above, so just remove temp dir
    try {
      await Deno.remove(tempDir, { recursive: true });
    } catch {
      // Ignore cleanup errors
    }
  }
});

Deno.test("DatabaseService: getActivitiesByActionType returns filtered results", async () => {
  const { db, cleanup } = await initTestDbService();
  try {
    const traceId = crypto.randomUUID();

    // Log different action types
    db.logActivity(MemoryBankSource.USER, "type.one", "target1", {}, traceId);
    db.logActivity(MemoryBankSource.USER, "type.two", "target2", {}, traceId);
    db.logActivity(MemoryBankSource.USER, "type.one", "target3", {}, traceId);

    await db.waitForFlush();

    const typeOne = db.getActivitiesByActionType("type.one");
    const typeTwo = db.getActivitiesByActionType("type.two");

    assertEquals(typeOne.length, 2);
    assertEquals(typeTwo.length, 1);
    assertEquals(typeOne[0].action_type, "type.one");
    assertEquals(typeTwo[0].action_type, "type.two");

    await db.close();
  } finally {
    await cleanup();
  }
});

Deno.test("DatabaseService: getRecentActivity returns limited results", async () => {
  const { db, cleanup } = await initTestDbService();
  try {
    const traceId = crypto.randomUUID();

    // Log 10 activities
    for (let i = 0; i < 10; i++) {
      db.logActivity(MemoryBankSource.USER, "test.action", `target-${i}`, { index: i }, traceId);
    }

    await db.waitForFlush();

    // Get recent with limit
    const recent = await db.getRecentActivity(5);
    assertEquals(recent.length, 5);

    // All should have the same trace_id
    for (const activity of recent) {
      assertEquals(activity.trace_id, traceId);
    }

    await db.close();
  } finally {
    await cleanup();
  }
});

Deno.test("DatabaseService: getRecentActivity flushes pending logs", async () => {
  const { db, cleanup } = await initTestDbService();
  try {
    const traceId = crypto.randomUUID();

    // Log activities without waiting for flush
    db.logActivity(MemoryBankSource.USER, "test.action", "target", { test: 1 }, traceId);
    db.logActivity(MemoryBankSource.USER, "test.action", "target", { test: 2 }, traceId);

    // getRecentActivity should flush pending logs
    const recent = await db.getRecentActivity(10);
    assertEquals(recent.length, 2);

    await db.close();
  } finally {
    await cleanup();
  }
});

Deno.test("DatabaseService: handles null identity_id", async () => {
  const { db, cleanup } = await initTestDbService();
  try {
    const traceId = crypto.randomUUID();

    // Log with explicit null agent
    db.logActivity(MemoryBankSource.USER, "test.action", "target", { test: 1 }, traceId, null);

    await db.waitForFlush();

    const activities = db.getActivitiesByTrace(traceId);
    assertEquals(activities.length, 1);
    assertEquals(activities[0].identity_id, null);

    await db.close();
  } finally {
    await cleanup();
  }
});

Deno.test("DatabaseService: handles null target", async () => {
  const { db, cleanup } = await initTestDbService();
  try {
    const traceId = crypto.randomUUID();

    // Log with null target
    db.logActivity(MemoryBankSource.USER, "test.action", null, { test: 1 }, traceId);

    await db.waitForFlush();

    const activities = db.getActivitiesByTrace(traceId);
    assertEquals(activities.length, 1);
    assertEquals(activities[0].target, null);

    await db.close();
  } finally {
    await cleanup();
  }
});

Deno.test("DatabaseService: handles complex payload objects", async () => {
  const { db, cleanup } = await initTestDbService();
  try {
    const traceId = crypto.randomUUID();

    const complexPayload = {
      nested: {
        object: {
          with: "values",
        },
      },
      array: [1, 2, 3],
      boolean: true,
      number: 42,
      nullValue: null,
    };

    db.logActivity(MemoryBankSource.USER, "test.action", "target", complexPayload, traceId);

    await db.waitForFlush();

    const activities = db.getActivitiesByTrace(traceId);
    assertEquals(activities.length, 1);

    const payload = activities[0].payload;
    assertEquals(JSON.parse(payload).nested.object.with, "values");
    assertEquals(JSON.parse(payload).array, [1, 2, 3]);
    assertEquals(JSON.parse(payload).boolean, true);
    assertEquals(JSON.parse(payload).number, 42);
    assertEquals(JSON.parse(payload).nullValue, null);

    await db.close();
  } finally {
    await cleanup();
  }
});

Deno.test("DatabaseService: generates unique activity IDs", async () => {
  const { db, cleanup } = await initTestDbService();
  try {
    const traceId = crypto.randomUUID();

    // Log multiple activities
    for (let i = 0; i < 5; i++) {
      db.logActivity(MemoryBankSource.USER, "test.action", "target", {}, traceId);
    }

    await db.waitForFlush();

    const activities = db.getActivitiesByTrace(traceId);
    const ids = activities.map((a) => a.id);

    // All IDs should be unique
    const uniqueIds = new Set(ids);
    assertEquals(uniqueIds.size, 5);

    await db.close();
  } finally {
    await cleanup();
  }
});

Deno.test("DatabaseService: auto-generates trace_id if not provided", async () => {
  const { db, cleanup } = await initTestDbService();
  try {
    // Log without trace_id
    db.logActivity(MemoryBankSource.USER, "test.action", "target", {});

    await db.waitForFlush();

    const recent = await db.getRecentActivity(1);
    assertEquals(recent.length, 1);
    assertExists(recent[0].trace_id);
    assertEquals(recent[0].trace_id.length, 36); // UUID format

    await db.close();
  } finally {
    await cleanup();
  }
});

Deno.test("DatabaseService: persists data across connections", async () => {
  const { db: db1, tempDir, cleanup: _cleanup } = await initTestDbService();
  try {
    const traceId = crypto.randomUUID();

    // First connection - write data
    db1.logActivity(MemoryBankSource.USER, "test.action", "target", { test: 1 }, traceId);
    await db1.waitForFlush();
    await db1.close();

    // Second connection - read data
    const config = createMockConfig(tempDir);
    const db2 = new DatabaseService(config);
    // Initialize schema for second connection
    initActivityTableSchema(db2);

    const activities = db2.getActivitiesByTrace(traceId);
    assertEquals(activities.length, 1);
    assertEquals(activities[0].action_type, "test.action");
    await db2.close();
  } finally {
    // Note: cleanup() closes db, but db1 is already closed above, so just remove temp dir
    try {
      await Deno.remove(tempDir, { recursive: true });
    } catch {
      // Ignore cleanup errors
    }
  }
});

Deno.test("DatabaseService: handles rapid concurrent logging", async () => {
  const { db, cleanup } = await initTestDbService();
  try {
    const traceId = crypto.randomUUID();

    // Log many activities rapidly
    const promises = [];
    for (let i = 0; i < 50; i++) {
      db.logActivity(MemoryBankSource.USER, "test.action", `target-${i}`, { index: i }, traceId);
      // Add small async operation to simulate concurrency
      promises.push(
        new Promise((resolve) => queueMicrotask(() => resolve(undefined))),
      );
    }

    await Promise.all(promises);
    await db.waitForFlush();

    const activities = db.getActivitiesByTrace(traceId);
    assertEquals(activities.length, 50);

    await db.close();
  } finally {
    await cleanup();
  }
});

Deno.test("DatabaseService: handles transaction rollback on error", async () => {
  const { db, cleanup } = await initTestDbService();
  try {
    const traceId = crypto.randomUUID();
    const originalExec = db.instance.exec.bind(db.instance);
    let callCount = 0;

    (db.instance as Partial<{ exec: (sql: string, ...args: string[]) => unknown }> as {
      exec: (sql: string, ...args: string[]) => unknown;
    }).exec = (
      sql: string,
      ...args: string[]
    ) => {
      if (typeof sql === "string" && sql.includes("INSERT INTO activity") && callCount === 0) {
        callCount++;
        throw new Error("Simulated insertion error");
      }
      return originalExec(sql, ...(args as never[]));
    };

    db.logActivity(MemoryBankSource.USER, "test.fail", "target", {}, traceId);
    await db.waitForFlush();

    const activities = db.getActivitiesByTrace(traceId);
    assertEquals(activities.length, 0);
  } finally {
    await cleanup();
  }
});

Deno.test("DatabaseService: retries on database locked", async () => {
  const { db, cleanup } = await initTestDbService();
  try {
    const traceId = crypto.randomUUID();
    const originalExec = db.instance.exec.bind(db.instance);
    let attempts = 0;

    (db.instance as Partial<{ exec: (sql: string, ...args: string[]) => unknown }> as {
      exec: (sql: string, ...args: string[]) => unknown;
    }).exec = (
      sql: string,
      ...args: string[]
    ) => {
      if (typeof sql === "string" && (sql.includes("COMMIT") || sql.includes("INSERT")) && attempts < 2) {
        attempts++;
        throw new Error("database is locked");
      }
      return originalExec(sql, ...(args as Parameters<typeof originalExec>));
    };

    db.logActivity(MemoryBankSource.USER, "test.retry", "target", {}, traceId);

    // Wait for retries
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await db.waitForFlush();

    const activities = db.getActivitiesByTrace(traceId);
    assertEquals(activities.length, 1);
    assert(attempts > 0);
  } finally {
    await cleanup();
  }
});
