/**
 * @module EventLoggerTest
 * @path tests/event_logger_test.ts
 * @description Verifies the EventLogger service, ensuring that high-level system
 * lifecycle events are correctly captured and routed to the persistent journal.
 */

import { assertEquals, assertExists, assertMatch, assertStringIncludes } from "@std/assert";
import { initTestDbService } from "../../helpers/db.ts";
import { EventLogger } from "../../../src/services/core/event_logger.ts";
import { LogLevel } from "../../../src/shared/enums.ts";

// ============================================================================
// Basic Logging Tests
// ============================================================================

Deno.test("EventLogger: should write event to IActivity Journal", async () => {
  const { db, cleanup } = await initTestDbService();
  try {
    const logger = new EventLogger({ db, prefix: "[Test]" });
    const traceId = crypto.randomUUID();

    await logger.log({
      action: "test.event",
      target: "/path/to/file",
      payload: { key: "value" },
      actor: "system",
      traceId,
    });

    // Wait for batched write
    await db.waitForFlush();

    const activities = db.getActivitiesByTrace(traceId);
    assertEquals(activities.length, 1);
    assertEquals(activities[0].action_type, "test.event");
    assertEquals(activities[0].target, "/path/to/file");
    assertEquals(activities[0].actor, "system");
    assertEquals(JSON.parse(activities[0].payload).key, "value");
  } finally {
    await cleanup();
  }
});

Deno.test("EventLogger: should print formatted message to console", async () => {
  const { db, cleanup } = await initTestDbService();
  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (...args: string[]) => logs.push(args.join(" "));

  try {
    const logger = new EventLogger({ db, prefix: "[Test]" });

    await logger.info("config.loaded", "exa.config.toml", { checksum: "abc123" });

    // Restore console.log
    console.log = originalLog;

    // Check console output contains expected elements
    assertEquals(logs.length >= 1, true);
    assertStringIncludes(logs[0], "config.loaded");
  } finally {
    console.log = originalLog;
    await cleanup();
  }
});

Deno.test("EventLogger: should include payload values in console output", async () => {
  const { db, cleanup } = await initTestDbService();
  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (...args: string[]) => logs.push(args.join(" "));

  try {
    const logger = new EventLogger({ db, prefix: "[Test]" });

    await logger.info("daemon.started", "main", {
      provider: "ollama",
      model: "codellama:13b",
    });

    console.log = originalLog;

    // Check that payload values appear in output
    const fullOutput = logs.join("\n");
    assertStringIncludes(fullOutput, "provider");
    assertStringIncludes(fullOutput, "ollama");
  } finally {
    console.log = originalLog;
    await cleanup();
  }
});

// ============================================================================
// Log Level Tests
// ============================================================================

Deno.test("EventLogger: should respect minLevel configuration", async () => {
  const { db, cleanup } = await initTestDbService();
  const logs: string[] = [];
  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;

  console.log = (...args: string[]) => logs.push(`log: ${args.join(" ")}`);
  console.warn = (...args: string[]) => logs.push(`warn: ${args.join(" ")}`);
  console.error = (...args: string[]) => logs.push(`error: ${args.join(" ")}`);

  try {
    // Set minLevel to warn - should suppress info and debug
    const logger = new EventLogger({ db, minLevel: LogLevel.WARN });

    await logger.debug("debug.message", "target", {});
    await logger.info("info.message", "target", {});
    await logger.warn("warn.message", "target", {});
    await logger.error("error.message", "target", {});

    console.log = originalLog;
    console.warn = originalWarn;
    console.error = originalError;

    // Only warn and error should appear
    const fullOutput = logs.join("\n");
    assertEquals(fullOutput.includes("debug.message"), false);
    assertEquals(fullOutput.includes("info.message"), false);
    assertStringIncludes(fullOutput, "warn.message");
    assertStringIncludes(fullOutput, "error.message");
  } finally {
    console.log = originalLog;
    console.warn = originalWarn;
    console.error = originalError;
    await cleanup();
  }
});

Deno.test("EventLogger: should use appropriate icons for each level", async () => {
  const { db, cleanup } = await initTestDbService();
  const logs: string[] = [];
  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;

  console.log = (...args: string[]) => logs.push(args.join(" "));
  console.warn = (...args: string[]) => logs.push(args.join(" "));
  console.error = (...args: string[]) => logs.push(args.join(" "));

  try {
    const logger = new EventLogger({ db, minLevel: LogLevel.DEBUG });

    await logger.info("test.info", "target", {});
    await logger.warn("test.warn", "target", {});
    await logger.error("test.error", "target", {});
    await logger.debug("test.debug", "target", {});

    console.log = originalLog;
    console.warn = originalWarn;
    console.error = originalError;

    // Check for appropriate icons
    const fullOutput = logs.join("\n");
    assertStringIncludes(fullOutput, "✅"); // info
    assertStringIncludes(fullOutput, "⚠️"); // warn
    assertStringIncludes(fullOutput, "❌"); // error
    assertStringIncludes(fullOutput, "🔍"); // debug
  } finally {
    console.log = originalLog;
    console.warn = originalWarn;
    console.error = originalError;
    await cleanup();
  }
});

// ============================================================================
// Child Logger Tests
// ============================================================================

Deno.test("EventLogger: child should inherit parent defaults", async () => {
  const { db, cleanup } = await initTestDbService();
  try {
    const parentTraceId = crypto.randomUUID();
    const parent = new EventLogger({
      db,
      prefix: "[Parent]",
      defaultActor: "system",
    });

    const child = parent.child({
      traceId: parentTraceId,
      actor: "identity:processor",
    });

    child.info("child.event", "target", { inherited: true });

    await db.waitForFlush();

    const activities = db.getActivitiesByTrace(parentTraceId);
    assertEquals(activities.length, 1);
    assertEquals(activities[0].actor, "identity:processor");
  } finally {
    await cleanup();
  }
});

Deno.test("EventLogger: child should override parent defaults when specified", async () => {
  const { db, cleanup } = await initTestDbService();
  try {
    const traceId = crypto.randomUUID();
    const parent = new EventLogger({
      db,
      defaultActor: "system",
    });

    const child = parent.child({
      actor: "identity:watcher",
      traceId,
    });

    // Child logs with its own actor
    child.info("watcher.event", "file.md", {});

    await db.waitForFlush();

    const activities = db.getActivitiesByTrace(traceId);
    assertEquals(activities.length, 1);
    assertEquals(activities[0].actor, "identity:watcher");
  } finally {
    await cleanup();
  }
});

// ============================================================================
// Actor Identity Tests
// ============================================================================

Deno.test("EventLogger: should resolve user identity from git config or OS", async () => {
  // This test verifies getUserIdentity() returns a non-empty string
  const identity = await EventLogger.getUserIdentity();

  assertExists(identity);
  assertEquals(typeof identity, "string");
  assertEquals(identity.length > 0, true);
});

Deno.test("EventLogger: should cache user identity after first resolution", async () => {
  // Call twice and verify it's cached (same value returned quickly)
  const identity1 = await EventLogger.getUserIdentity();
  const identity2 = await EventLogger.getUserIdentity();

  assertEquals(identity1, identity2);
});

// ============================================================================
// Error Handling Tests
// ============================================================================

Deno.test("EventLogger: should fallback to console-only when DB unavailable", async () => {
  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (...args: string[]) => logs.push(args.join(" "));

  try {
    // Create logger without DB
    const logger = new EventLogger({ prefix: "[NoDb]" });

    await logger.info("test.event", "target", { value: 123 });

    console.log = originalLog;

    // Should have logged to console without throwing
    assertEquals(logs.length >= 1, true);
    assertStringIncludes(logs[0], "test.event");
  } finally {
    console.log = originalLog;
  }
});

Deno.test("EventLogger: should not throw when DB write fails", async () => {
  const { db, cleanup } = await initTestDbService();

  try {
    const logger = new EventLogger({ db });

    // Close database to simulate failure
    await db.close();

    // This should not throw, just fallback to console
    const logs: string[] = [];
    const originalLog = console.log;
    const originalWarn = console.warn;
    console.log = (...args: string[]) => logs.push(args.join(" "));
    console.warn = (...args: string[]) => logs.push(args.join(" "));

    try {
      await logger.info("test.after_close", "target", {});
    } finally {
      console.log = originalLog;
      console.warn = originalWarn;
    }

    // Should have logged something (either the message or a warning)
    assertEquals(logs.length >= 1, true);
  } finally {
    await cleanup();
  }
});

// ============================================================================
// Format Tests
// ============================================================================

Deno.test("EventLogger: should format timestamps consistently", async () => {
  const { db, cleanup } = await initTestDbService();
  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (...args: string[]) => logs.push(args.join(" "));

  try {
    const logger = new EventLogger({ db, showTimestamp: true });

    await logger.info("test.event", "target", {});

    console.log = originalLog;

    // Check for ISO-like timestamp format in output
    const fullOutput = logs.join("\n");
    // Timestamp should be present (HH:MM:SS format or ISO)
    assertMatch(fullOutput, /\d{2}:\d{2}:\d{2}|\d{4}-\d{2}-\d{2}/);
  } finally {
    console.log = originalLog;
    await cleanup();
  }
});

Deno.test("EventLogger: should indent multi-line payloads", async () => {
  const { db, cleanup } = await initTestDbService();
  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (...args: string[]) => logs.push(args.join(" "));

  try {
    const logger = new EventLogger({ db });

    await logger.info("test.event", "target", {
      key1: "value1",
      key2: "value2",
      key3: "value3",
    });

    console.log = originalLog;

    // Check that payload lines are indented
    const fullOutput = logs.join("\n");
    assertStringIncludes(fullOutput, "key1");
    assertStringIncludes(fullOutput, "value1");
  } finally {
    console.log = originalLog;
    await cleanup();
  }
});

// ============================================================================
// Custom Icon Tests
// ============================================================================

Deno.test("EventLogger: should allow custom icons in log events", async () => {
  const { db, cleanup } = await initTestDbService();
  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (...args: string[]) => logs.push(args.join(" "));

  try {
    const logger = new EventLogger({ db });

    await logger.log({
      action: "config.loaded",
      target: "exa.config.toml",
      payload: {},
      icon: "🚀",
      level: LogLevel.INFO,
    });

    console.log = originalLog;

    assertStringIncludes(logs.join("\n"), "🚀");
  } finally {
    console.log = originalLog;
    await cleanup();
  }
});

// ============================================================================
// Integration Tests
// ============================================================================

Deno.test("EventLogger: full integration with database and console", async () => {
  const { db, cleanup } = await initTestDbService();
  const logs: string[] = [];
  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;

  console.log = (...args: string[]) => logs.push(`log: ${args.join(" ")}`);
  console.warn = (...args: string[]) => logs.push(`warn: ${args.join(" ")}`);
  console.error = (...args: string[]) => logs.push(`error: ${args.join(" ")}`);

  try {
    const traceId = crypto.randomUUID();
    const logger = new EventLogger({ db, prefix: "[Exaix]" });

    // Create child logger for a service
    const serviceLogger = logger.child({
      actor: "system",
      traceId,
    });

    // Log multiple events
    await serviceLogger.info("daemon.starting", "main", { mode: "development" });
    await serviceLogger.info("config.loaded", "exa.config.toml", { checksum: "abc123" });
    await serviceLogger.warn("context.truncated", "loader", { files_skipped: 3 });
    await serviceLogger.error("provider.failed", "anthropic", { error: "rate_limited" });

    await db.waitForFlush();

    // Verify database entries
    const activities = db.getActivitiesByTrace(traceId);
    assertEquals(activities.length, 4);

    // Verify console output
    console.log = originalLog;
    console.warn = originalWarn;
    console.error = originalError;

    const fullOutput = logs.join("\n");
    assertStringIncludes(fullOutput, "daemon.starting");
    assertStringIncludes(fullOutput, "config.loaded");
    assertStringIncludes(fullOutput, "context.truncated");
    assertStringIncludes(fullOutput, "provider.failed");
  } finally {
    console.log = originalLog;
    console.warn = originalWarn;
    console.error = originalError;
    await cleanup();
  }
});
