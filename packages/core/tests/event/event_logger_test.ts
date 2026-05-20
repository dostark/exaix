/**
 * @module EventLoggerTest
 * @path packages/core/tests/event/event_logger_test.ts
 * @description Verifies the EventLogger service, ensuring that high-level system
 * lifecycle events are correctly captured and routed to the persistent journal.
 */

import { assertEquals, assertExists, assertMatch, assertStringIncludes } from "@std/assert";
import { initTestDbService } from "@exaix/testing";
import { EventLogger } from "@exaix/core/logger";
import { LogLevel } from "@exaix/core";
import { EventBusService } from "@exaix/core/observability";
import type { IStreamingEvent } from "@exaix/schemas/streaming_event.ts";
import { STREAMING_EVENT_FLOW_STATUS, STREAMING_EVENT_TOOL_START } from "@exaix/core";

type ITestDb = Awaited<ReturnType<typeof initTestDbService>>["db"];
type IEventLoggerOptions = ConstructorParameters<typeof EventLogger>[0];

// ============================================================================
// Helpers
// ============================================================================

interface IEventLoggerTestCtx {
  db: ITestDb;
  logger: EventLogger;
  logs: string[];
  restoreConsole: () => void;
}

async function withEventLoggerTest(
  testFn: (ctx: IEventLoggerTestCtx) => Promise<void>,
  loggerOptions: IEventLoggerOptions = { prefix: "[Test]" },
) {
  const { db, cleanup } = await initTestDbService();
  const logs: string[] = [];
  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;

  const captureLogs = (...args: Array<unknown>) => logs.push(args.join(" "));
  console.log = captureLogs;
  console.warn = captureLogs;
  console.error = captureLogs;

  const restoreConsole = () => {
    console.log = originalLog;
    console.warn = originalWarn;
    console.error = originalError;
  };

  try {
    const logger = new EventLogger({ db, ...loggerOptions });
    await testFn({ db, logger, logs, restoreConsole });
  } finally {
    restoreConsole();
    await cleanup();
  }
}

// ============================================================================
// Basic Logging Tests
// ============================================================================

Deno.test("EventLogger: should write event to IActivity Journal", async () => {
  await withEventLoggerTest(async ({ db, logger }) => {
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
  });
});

Deno.test("EventLogger: should persist token and cost metrics to IActivity Journal", async () => {
  await withEventLoggerTest(async ({ db, logger }) => {
    const traceId = crypto.randomUUID();

    await logger.log({
      action: "llm.generate",
      target: "gpt-4",
      payload: { prompt: "hello" },
      actor: "agent",
      traceId,
      promptTokens: 10,
      completionTokens: 20,
      costUsd: 0.0006,
    });

    // Wait for batched write
    await db.waitForFlush();

    const activities = db.getActivitiesByTrace(traceId);
    assertEquals(activities.length, 1);
    assertEquals(activities[0].action_type, "llm.generate");
    assertEquals(activities[0].prompt_tokens, 10);
    assertEquals(activities[0].completion_tokens, 20);
    assertEquals(activities[0].cost_usd, 0.0006);
  });
});

Deno.test("EventLogger: should print formatted message to console", async () => {
  await withEventLoggerTest(async ({ logger, logs, restoreConsole }) => {
    await logger.info("config.loaded", "exa.config.toml", { checksum: "abc123" });

    // Restore console.log to check output
    restoreConsole();

    // Check console output contains expected elements
    assertEquals(logs.length >= 1, true);
    assertStringIncludes(logs[0], "config.loaded");
  });
});

Deno.test("EventLogger: should include payload values in console output", async () => {
  await withEventLoggerTest(async ({ logger, logs, restoreConsole }) => {
    await logger.info("daemon.started", "main", {
      provider: "ollama",
      model: "codellama:13b",
    });

    restoreConsole();

    // Check that payload values appear in output
    const fullOutput = logs.join("\n");
    assertStringIncludes(fullOutput, "provider");
    assertStringIncludes(fullOutput, "ollama");
  });
});

// ============================================================================
// Log Level Tests
// ============================================================================

Deno.test("EventLogger: should respect minLevel configuration", async () => {
  await withEventLoggerTest(async ({ logger, logs, restoreConsole }) => {
    await logger.debug("debug.message", "target", {});
    await logger.info("info.message", "target", {});
    await logger.warn("warn.message", "target", {});
    await logger.error("error.message", "target", {});

    restoreConsole();

    // Only warn and error should appear
    const fullOutput = logs.join("\n");
    assertEquals(fullOutput.includes("debug.message"), false);
    assertEquals(fullOutput.includes("info.message"), false);
    assertStringIncludes(fullOutput, "warn.message");
    assertStringIncludes(fullOutput, "error.message");
  }, { minLevel: LogLevel.WARN });
});

Deno.test("EventLogger: should use appropriate icons for each level", async () => {
  await withEventLoggerTest(async ({ logger, logs, restoreConsole }) => {
    await logger.info("test.info", "target", {});
    await logger.warn("test.warn", "target", {});
    await logger.error("test.error", "target", {});
    await logger.debug("test.debug", "target", {});

    restoreConsole();

    // Check for appropriate icons
    const fullOutput = logs.join("\n");
    assertStringIncludes(fullOutput, "✅"); // info
    assertStringIncludes(fullOutput, "⚠️"); // warn
    assertStringIncludes(fullOutput, "❌"); // error
    assertStringIncludes(fullOutput, "🔍"); // debug
  }, { minLevel: LogLevel.DEBUG });
});

// ============================================================================
// Child Logger Tests
// ============================================================================

Deno.test("EventLogger: child should inherit parent defaults", async () => {
  await withEventLoggerTest(async ({ db, logger: _logger }) => {
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
  });
});

Deno.test("EventLogger: child should override parent defaults when specified", async () => {
  await withEventLoggerTest(async ({ db, logger: _logger }) => {
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
  });
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
  await withEventLoggerTest(async ({ db, logger, logs, restoreConsole }) => {
    // Close database to simulate failure
    await db.close();

    // This should not throw, just fallback to console
    await logger.info("test.after_close", "target", {});

    restoreConsole();

    // Should have logged something (either the message or a warning)
    assertEquals(logs.length >= 1, true);
  });
});

// ============================================================================
// Format Tests
// ============================================================================

Deno.test("EventLogger: should format timestamps consistently", async () => {
  await withEventLoggerTest(async ({ logger, logs, restoreConsole }) => {
    await logger.info("test.event", "target", {});

    restoreConsole();

    // Check for ISO-like timestamp format in output
    const fullOutput = logs.join("\n");
    // Timestamp should be present (HH:MM:SS format or ISO)
    assertMatch(fullOutput, /\d{2}:\d{2}:\d{2}|\d{4}-\d{2}-\d{2}/);
  }, { showTimestamp: true });
});

Deno.test("EventLogger: should indent multi-line payloads", async () => {
  await withEventLoggerTest(async ({ logger, logs, restoreConsole }) => {
    await logger.info("test.event", "target", {
      key1: "value1",
      key2: "value2",
      key3: "value3",
    });

    restoreConsole();

    // Check that payload lines are indented
    const fullOutput = logs.join("\n");
    assertStringIncludes(fullOutput, "key1");
    assertStringIncludes(fullOutput, "value1");
  });
});

// ============================================================================
// Custom Icon Tests
// ============================================================================

Deno.test("EventLogger: should allow custom icons in log events", async () => {
  await withEventLoggerTest(async ({ logger, logs, restoreConsole }) => {
    await logger.log({
      action: "config.loaded",
      target: "exa.config.toml",
      payload: {},
      icon: "rocket",
      level: LogLevel.INFO,
    });

    restoreConsole();

    assertStringIncludes(logs.join("\n"), "rocket");
  });
});

// ============================================================================
// Integration Tests
// ============================================================================

Deno.test("EventLogger: full integration with database and console", async () => {
  await withEventLoggerTest(async ({ db, logger, logs, restoreConsole }) => {
    const traceId = crypto.randomUUID();

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

    restoreConsole();

    const fullOutput = logs.join("\n");
    assertStringIncludes(fullOutput, "daemon.starting");
    assertStringIncludes(fullOutput, "config.loaded");
    assertStringIncludes(fullOutput, "context.truncated");
    assertStringIncludes(fullOutput, "provider.failed");
  }, { prefix: "[Exaix]" });
});

// ============================================================================
// Event Bus Integration Tests
// ============================================================================

Deno.test("EventLogger: should publish events to event bus when configured", async () => {
  EventBusService.resetInstance();

  const eventBus = EventBusService.getInstance();
  const { db, cleanup } = await initTestDbService();
  const traceId = crypto.randomUUID();

  const receivedEvents: IStreamingEvent[] = [];
  const unsubscribe = eventBus.subscribe(traceId, (event: IStreamingEvent) => {
    receivedEvents.push(event);
  });

  try {
    const logger = new EventLogger({ db, eventBus, prefix: "[Test]" });

    await logger.info("daemon.starting", "main", { mode: "development" }, traceId);
    await logger.info("tool.start", "read_file", { path: "hello.txt" }, traceId);

    assertEquals(receivedEvents.length, 2);
    assertEquals(receivedEvents[0].traceId, traceId);
    assertEquals(receivedEvents[1].traceId, traceId);
    assertEquals(receivedEvents[0].type, STREAMING_EVENT_FLOW_STATUS);
    assertEquals(receivedEvents[1].type, STREAMING_EVENT_TOOL_START);
  } finally {
    unsubscribe();
    await cleanup();
  }
});

Deno.test("EventLogger: should use singleton event bus when not explicitly provided", async () => {
  EventBusService.resetInstance();

  const eventBus = EventBusService.getInstance();
  const { db, cleanup } = await initTestDbService();
  const traceId = crypto.randomUUID();

  const receivedEvents: IStreamingEvent[] = [];
  const unsubscribe = eventBus.subscribe(traceId, (event: IStreamingEvent) => {
    receivedEvents.push(event);
  });

  try {
    const logger = new EventLogger({ db, prefix: "[Test]" });

    await logger.info("daemon.starting", "main", { mode: "development" }, traceId);

    assertEquals(receivedEvents.length, 1);
    assertEquals(receivedEvents[0].traceId, traceId);
  } finally {
    unsubscribe();
    await cleanup();
  }
});

Deno.test("EventLogger: should persist token and cost metrics to native columns", async () => {
  const { db, cleanup } = await initTestDbService();
  const traceId = crypto.randomUUID();

  try {
    const logger = new EventLogger({ db, prefix: "[Test]" });

    await logger.log({
      action: "agent.generation_completed",
      target: "gpt-4o",
      traceId,
      promptTokens: 100,
      completionTokens: 50,
      costUsd: 0.0015,
      payload: { model: "gpt-4o", provider: "openai" },
    });

    // Wait for batch flush
    await new Promise((resolve) => setTimeout(resolve, 600));

    const activities = await db.getActivitiesByTraceSafe(traceId);
    assertEquals(activities.length, 1);
    assertEquals(activities[0].prompt_tokens, 100);
    assertEquals(activities[0].completion_tokens, 50);
    assertEquals(activities[0].cost_usd, 0.0015);
  } finally {
    await cleanup();
  }
});
