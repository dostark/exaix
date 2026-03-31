/**
 * @module StructuredLoggerTest
 * @path tests/services/structured/structured_logger_test.ts
 * @description Verifies the core StructuredLogger service, ensuring correct log level filtering,
 * asynchronous context propagation, and multi-sink (Console/File) dispatch logic.
 */

import { assert, assertEquals, assertRejects, assertStringIncludes, assertThrows } from "@std/assert";
import { assertSpyCalls, spy } from "@std/testing/mock";
import {
  ConsoleOutput,
  FileOutput,
  getGlobalLogger,
  type ILogOutput,
  initializeGlobalLogger,
  type IStructuredLogEntry,
  type IStructuredLoggerConfig,
  logError,
  logInfo,
  resetGlobalLogger,
  StructuredLogger,
} from "../../../src/services/logger/structured_logger.ts";
import { LogLevel } from "../../../src/shared/enums.ts";
// Removed db.ts IIStructuredLogEntry import as it conflicts with structured_logger IStructuredLogEntry

// ============================================================================
// Test Utilities
// ============================================================================

class MockOutput implements ILogOutput {
  public entries: IStructuredLogEntry[] = [];

  write(entry: IStructuredLogEntry): void {
    this.entries.push(entry);
  }
}

/**
 * Creates a test logger with mock output for testing
 */
function createTestLogger(
  minLevel: IStructuredLoggerConfig["minLevel"] = LogLevel.INFO,
  enablePerformanceTracking = false,
): { logger: StructuredLogger; output: MockOutput } {
  const output = new MockOutput();
  const config: IStructuredLoggerConfig = {
    minLevel,
    outputs: [output],
    enablePerformanceTracking,
  };

  const logger = new StructuredLogger(config);
  return { logger, output };
}

// ============================================================================
// Test Suites
// ============================================================================

Deno.test("StructuredLogger - Initialization", async (t) => {
  await t.step("should initialize with console output", () => {
    const consoleOutput = new ConsoleOutput();
    const config: IStructuredLoggerConfig = {
      minLevel: LogLevel.INFO,
      outputs: [consoleOutput],
      enablePerformanceTracking: false,
    };

    const logger = new StructuredLogger(config);
    assert(logger instanceof StructuredLogger);
  });

  await t.step("should initialize with file output", async () => {
    const testLog = "/tmp/test-init.log";
    try {
      const fileOutput = new FileOutput(testLog);
      const config: IStructuredLoggerConfig = {
        minLevel: LogLevel.INFO,
        outputs: [fileOutput],
        enablePerformanceTracking: false,
      };

      const logger = new StructuredLogger(config);
      assert(logger instanceof StructuredLogger);
    } finally {
      await Deno.remove(testLog).catch(() => {});
    }
  });

  await t.step("should initialize with multiple outputs", async () => {
    const testLog = "/tmp/test-multi.log";
    try {
      const consoleOutput = new ConsoleOutput();
      const fileOutput = new FileOutput(testLog);
      const config: IStructuredLoggerConfig = {
        minLevel: LogLevel.INFO,
        outputs: [consoleOutput, fileOutput],
        enablePerformanceTracking: false,
      };

      const logger = new StructuredLogger(config);
      assert(logger instanceof StructuredLogger);
    } finally {
      await Deno.remove(testLog).catch(() => {});
    }
  });
});

Deno.test("StructuredLogger - Log Level Filtering", async (t) => {
  await t.step("should filter debug messages when minLevel is LogLevel.INFO", () => {
    const { logger, output } = createTestLogger(LogLevel.INFO);
    logger.debug("Debug message");
    logger.info("Info message");

    assertEquals(output.entries.length, 1);
    assertEquals(output.entries[0].level, LogLevel.INFO);
  });

  await t.step("should allow all levels when minLevel is debug", () => {
    const { logger, output } = createTestLogger(LogLevel.DEBUG);
    logger.debug("Debug message");
    logger.info("Info message");
    logger.warn("Warn message");
    logger.error("Error message");
    logger.fatal("Fatal message");

    assertEquals(output.entries.length, 5);
    assertEquals(output.entries.map((e) => e.level), [
      LogLevel.DEBUG,
      LogLevel.INFO,
      LogLevel.WARN,
      LogLevel.ERROR,
      LogLevel.FATAL,
    ]);
  });

  await t.step("should only allow error and fatal when minLevel is error", () => {
    const { logger, output } = createTestLogger(LogLevel.ERROR);
    logger.debug("Debug message");
    logger.info("Info message");
    logger.warn("Warn message");
    logger.error("Error message");
    logger.fatal("Fatal message");

    assertEquals(output.entries.length, 2);
    assertEquals(output.entries.map((e) => e.level), [LogLevel.ERROR, LogLevel.FATAL]);
  });
});

Deno.test("StructuredLogger - Context Management", async (t) => {
  await t.step("should include context in log entries", () => {
    const { logger, output } = createTestLogger(LogLevel.INFO);
    logger.setContext({
      trace_id: "trace-123",
      user_id: "user-456",
      operation: "test-op",
    });

    logger.info("Test message");

    assertEquals(output.entries.length, 1);
    assertEquals(output.entries[0].context.trace_id, "trace-123");
    assertEquals(output.entries[0].context.user_id, "user-456");
    assertEquals(output.entries[0].context.operation, "test-op");
  });

  await t.step("should merge context with setContext", () => {
    const { logger, output } = createTestLogger(LogLevel.INFO);
    logger.setContext({ trace_id: "trace-123" });
    logger.setContext({ user_id: "user-456" });

    logger.info("Test message");

    assertEquals(output.entries[0].context.trace_id, "trace-123");
    assertEquals(output.entries[0].context.user_id, "user-456");
  });

  await t.step("child logger should inherit parent context", () => {
    const { logger: parentLogger, output } = createTestLogger(LogLevel.INFO);
    parentLogger.setContext({
      trace_id: "trace-123",
      user_id: "user-456",
    });

    const childLogger = parentLogger.child({
      operation: "child-op",
      request_id: "req-789",
    });

    childLogger.info("Child message");

    assertEquals(output.entries[0].context.trace_id, "trace-123");
    assertEquals(output.entries[0].context.user_id, "user-456");
    assertEquals(output.entries[0].context.operation, "child-op");
    assertEquals(output.entries[0].context.request_id, "req-789");
  });
});

Deno.test("StructuredLogger - Error Handling", async (t) => {
  await t.step("should include error details in log entries", () => {
    const { logger, output } = createTestLogger(LogLevel.INFO);
    interface TestError extends Error {
      code?: string;
    }
    const testError = new Error("Test error message") as TestError;
    testError.name = "TestError";
    testError.code = "TEST_ERROR";

    logger.error("Something went wrong", testError);

    assertEquals(output.entries.length, 1);
    assertEquals(output.entries[0].level, LogLevel.ERROR);
    assertEquals(output.entries[0].error?.name, "TestError");
    assertEquals(output.entries[0].error?.message, "Test error message");
    assertEquals(output.entries[0].error?.code, "TEST_ERROR");
    assert(output.entries[0].error?.stack);
  });

  await t.step("should handle error logging without error object", () => {
    const { logger, output } = createTestLogger(LogLevel.INFO);
    logger.error("Error without exception");

    assertEquals(output.entries[0].error, undefined);
  });
});

Deno.test("StructuredLogger - Performance Tracking", async (t) => {
  await t.step("should track operation performance when enabled", async () => {
    const { logger, output } = createTestLogger(LogLevel.INFO, true);

    const result = await logger.time("test-operation", async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return "success";
    });

    assertEquals(result, "success");

    // Should have logged the operation completion
    const completionLog = output.entries.find((e) => e.message.includes("Operation completed"));
    assert(completionLog);
    assert(completionLog?.metadata?.performance);
    const performance = completionLog.metadata.performance as { duration_ms: number };
    assert(performance.duration_ms >= 10);
  });

  await t.step("should track failed operations", async () => {
    const { logger, output } = createTestLogger(LogLevel.INFO, true);

    await assertRejects(async () => {
      await logger.time("failing-operation", () => {
        throw new Error("Operation failed");
      });
    });

    // Should have logged the operation failure
    const failureLog = output.entries.find((e) => e.message.includes("Operation failed"));
    assert(failureLog);
    assertEquals(failureLog?.level, LogLevel.ERROR);
    assert(failureLog?.error);
  });

  await t.step("should skip performance tracking when disabled", async () => {
    const { logger, output } = createTestLogger(LogLevel.INFO, false);

    const result = await logger.time("test-operation", async () => {
      await Promise.resolve(); // Make it actually async
      return "success";
    });

    assertEquals(result, "success");
    // Should not have logged anything since performance tracking is disabled
    assertEquals(output.entries.length, 0);
  });
});

Deno.test("StructuredLogger - Console Output", async (t) => {
  await t.step("should format log entries correctly", () => {
    const consoleOutput = new ConsoleOutput();
    const mockConsole = spy(console, "log");

    try {
      const entry: IStructuredLogEntry = {
        timestamp: "2023-01-01T12:00:00.000Z",
        level: LogLevel.INFO,
        message: "Test message",
        context: {
          trace_id: "trace-12345678",
          user_id: "user-456",
          operation: "test-op",
        },
        metadata: { key: "value" },
      };

      consoleOutput.write(entry);

      assertSpyCalls(mockConsole, 1);
      const loggedMessage = mockConsole.calls[0].args[0];
      assertStringIncludes(loggedMessage, "2023-01-01T12:00:00.000Z");
      assertStringIncludes(loggedMessage, "INFO ");
      assertStringIncludes(loggedMessage, "Test message");
      assertStringIncludes(loggedMessage, "[trace=trace-12 user=user-456 op=test-op]");
      assertStringIncludes(loggedMessage, '{"key":"value"}');
    } finally {
      mockConsole.restore();
    }
  });

  await t.step("should use appropriate console methods for different levels", () => {
    const consoleOutput = new ConsoleOutput();
    const mockLog = spy(console, "log");
    const mockWarn = spy(console, "warn");
    const mockError = spy(console, "error");

    try {
      consoleOutput.write({
        timestamp: "2023-01-01T12:00:00.000Z",
        level: LogLevel.INFO,
        message: "Info message",
        context: {},
      });

      consoleOutput.write({
        timestamp: "2023-01-01T12:00:00.000Z",
        level: LogLevel.WARN,
        message: "Warn message",
        context: {},
      });

      consoleOutput.write({
        timestamp: "2023-01-01T12:00:00.000Z",
        level: LogLevel.ERROR,
        message: "Error message",
        context: {},
      });

      assertSpyCalls(mockLog, 1);
      assertSpyCalls(mockWarn, 1);
      assertSpyCalls(mockError, 1);
    } finally {
      mockLog.restore();
      mockWarn.restore();
      mockError.restore();
    }
  });
});

Deno.test("StructuredLogger - File Output", async (t) => {
  const testFile = "/tmp/structured-log-test.jsonl";

  // Clean up before test
  try {
    await Deno.remove(testFile);
  } catch {
    // File doesn't exist, continue
  }

  await t.step("should write log entries to file", async () => {
    const fileOutput = new FileOutput(testFile);
    const entry: IStructuredLogEntry = {
      timestamp: "2023-01-01T12:00:00.000Z",
      level: LogLevel.INFO,
      message: "Test file message",
      context: { trace_id: "trace-123" },
    };

    await fileOutput.write(entry);

    const content = await Deno.readTextFile(testFile);
    const lines = content.trim().split("\n");
    assertEquals(lines.length, 1);

    const parsedEntry = JSON.parse(lines[0]);
    assertEquals(parsedEntry.level, LogLevel.INFO);
    assertEquals(parsedEntry.message, "Test file message");
    assertEquals(parsedEntry.context.trace_id, "trace-123");
  });

  await t.step("should handle file write errors gracefully", async () => {
    const fileOutput = new FileOutput("/invalid/path/log.json");
    const mockConsoleError = spy(console, "error");

    try {
      await fileOutput.write({
        timestamp: "2023-01-01T12:00:00.000Z",
        level: LogLevel.INFO,
        message: "Test message",
        context: {},
      });

      // Should have logged the error
      assertSpyCalls(mockConsoleError, 1);
    } finally {
      mockConsoleError.restore();
    }
  });

  // Clean up
  try {
    await Deno.remove(testFile);
  } catch {
    // Ignore cleanup errors
  }
});

Deno.test("StructuredLogger - Global Logger", async (t) => {
  await t.step("should initialize and get global logger", () => {
    const mockOutput = new MockOutput();
    const config: IStructuredLoggerConfig = {
      minLevel: LogLevel.INFO,
      outputs: [mockOutput],
      enablePerformanceTracking: false,
    };

    const logger = initializeGlobalLogger(config);
    assert(logger instanceof StructuredLogger);

    const retrievedLogger = getGlobalLogger();
    assertEquals(logger, retrievedLogger);
  });

  await t.step("should throw error when getting uninitialized global logger", () => {
    // Reset global logger
    resetGlobalLogger();

    assertThrows(
      () => {
        getGlobalLogger();
      },
      Error,
      "Global logger not initialized",
    );
  });

  await t.step("should use convenience functions with global logger", () => {
    const mockOutput = new MockOutput();
    const config: IStructuredLoggerConfig = {
      minLevel: LogLevel.INFO,
      outputs: [mockOutput],
      enablePerformanceTracking: false,
    };

    initializeGlobalLogger(config);

    logInfo("Test info message");
    logError("Test error message", new Error("Test error"));

    assertEquals(mockOutput.entries.length, 2);
    assertEquals(mockOutput.entries[0].level, LogLevel.INFO);
    assertEquals(mockOutput.entries[1].level, LogLevel.ERROR);
    assert(mockOutput.entries[1].error);
  });
});

Deno.test("StructuredLogger - Audit vs Notification Evaluation", async (t) => {
  await t.step("should identify security-critical audit events", () => {
    const { logger, output } = createTestLogger(LogLevel.INFO);

    // Audit events - security critical
    logger.error("Authentication failed", new Error("Invalid credentials"), {
      audit_event: true,
      user_id: "user-123",
      ip_address: "192.168.1.1",
      user_agent: "Mozilla/5.0",
    });

    logger.info("User login successful", {
      audit_event: true,
      user_id: "user-456",
      session_id: "session-789",
    });

    // Notification events - operational
    logger.warn("High memory usage detected", {
      memory_mb: 850,
      threshold_mb: 800,
    });

    logger.info("Cache miss rate above threshold", {
      miss_rate: 0.15,
      threshold: 0.10,
    });

    assertEquals(output.entries.length, 4);

    // Verify audit events have audit_event flag
    const auditEntries = output.entries.filter((e) => e.metadata?.audit_event);
    assertEquals(auditEntries.length, 2);

    // Verify notification events don't have audit_event flag
    const notificationEntries = output.entries.filter((e) => !e.metadata?.audit_event);
    assertEquals(notificationEntries.length, 2);
  });

  await t.step("should support structured audit context", () => {
    const { logger, output } = createTestLogger(LogLevel.INFO);
    logger.setContext({
      trace_id: "audit-trace-123",
      operation: "user-authentication",
    });

    logger.error("Failed login attempt", new Error("Invalid password"), {
      audit_event: true,
      event_type: "authentication_failure",
      user_id: "user-123",
      ip_address: "10.0.0.1",
      timestamp: new Date().toISOString(),
      details: {
        attempt_count: 3,
        lockout_duration_minutes: 15,
      },
    });

    assertEquals(output.entries.length, 1);
    const entry = output.entries[0];

    assertEquals(entry.context.operation, "user-authentication");
    assertEquals(entry.metadata?.audit_event, true);
    assertEquals(entry.metadata?.event_type, "authentication_failure");
    assert(entry.metadata?.details);
  });
});
