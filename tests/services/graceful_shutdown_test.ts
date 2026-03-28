/**
 * @module GracefulShutdownTest
 * @path tests/services/graceful_shutdown_test.ts
 * @description Verifies the process termination logic, ensuring registered cleanup tasks
 * are executed in correct LIFO order to prevent resource leaks and database corruption.
 */

import { assert, assertEquals } from "@std/assert";
import { assertSpyCalls, spy, stub } from "@std/testing/mock";
import { GracefulShutdown } from "../../src/services/graceful_shutdown.ts";
import { createMockLogger } from "../helpers/graceful_shutdown_test_helpers.ts";
import {
  LOG_MSG_ERROR_HANDLERS_REGISTERED,
  LOG_MSG_SIGNAL_HANDLERS_REGISTERED,
  TEST_EVENT_ERROR,
  TEST_EVENT_UNHANDLED_REJECTION,
  TEST_SIGNAL_SIGINT,
  TEST_SIGNAL_SIGTERM,
} from "../config/constants.ts";

/**
 * Tests for GracefulShutdown - Comprehensive Graceful Shutdown Handling
 */

Deno.test("GracefulShutdown: initializes with logger", () => {
  const mockLogger = createMockLogger();

  const shutdown = new GracefulShutdown(mockLogger);
  assertEquals(shutdown["shuttingDown"], false);
  assertEquals(shutdown["cleanupTasks"].length, 0);
});

Deno.test("GracefulShutdown: registers cleanup tasks", () => {
  const mockLogger = createMockLogger();

  const shutdown = new GracefulShutdown(mockLogger);

  const mockHandler = spy(async () => {
    await Promise.resolve();
  });
  shutdown.registerCleanup("test-task", mockHandler, 5000);

  assertEquals(shutdown["cleanupTasks"].length, 1);
  assertEquals(shutdown["cleanupTasks"][0].name, "test-task");
  assertEquals(shutdown["cleanupTasks"][0].handler, mockHandler);
  assertEquals(shutdown["cleanupTasks"][0].timeout, 5000);
});

Deno.test("GracefulShutdown: runs cleanup tasks in reverse order (LIFO)", async () => {
  const mockLogger = createMockLogger();

  const shutdown = new GracefulShutdown(mockLogger);

  const callOrder: string[] = [];
  const task1 = spy(async () => {
    callOrder.push("task1");
    await Promise.resolve();
  });

  const task2 = spy(async () => {
    callOrder.push("task2");
    await Promise.resolve();
  });
  const task3 = spy(async () => {
    callOrder.push("task3");
    await Promise.resolve();
  });

  shutdown.registerCleanup("task1", task1);
  shutdown.registerCleanup("task2", task2);
  shutdown.registerCleanup("task3", task3);

  await shutdown.shutdown(0, false);

  assertEquals(callOrder, ["task3", "task2", "task1"]);
});

Deno.test("GracefulShutdown: handles cleanup task failures", async () => {
  const mockLogger = createMockLogger();

  const shutdown = new GracefulShutdown(mockLogger);

  const failingTask = spy(async () => {
    await Promise.resolve();
    throw new Error("Task failed");
  });

  shutdown.registerCleanup("failing-task", failingTask);

  await shutdown.shutdown(0, false);

  assertSpyCalls(mockLogger.error, 2); // One for the task failure, one for completion
});

Deno.test("GracefulShutdown: prevents multiple shutdown attempts", async () => {
  const mockLogger = createMockLogger();

  const shutdown = new GracefulShutdown(mockLogger);

  const task = spy(async () => {
    await Promise.resolve();
  });
  shutdown.registerCleanup("task", task);

  // Start two shutdowns concurrently
  const shutdown1 = shutdown.shutdown(0, false);
  const shutdown2 = shutdown.shutdown(0, false);

  await Promise.all([shutdown1, shutdown2]);

  assertSpyCalls(mockLogger.warn, 1); // "Shutdown already in progress"
});

Deno.test("GracefulShutdown: uses default timeout when not specified", () => {
  const mockLogger = createMockLogger();

  const shutdown = new GracefulShutdown(mockLogger);

  const task = spy(async () => {
    await Promise.resolve();
  });
  shutdown.registerCleanup("task", task); // No timeout specified

  assertEquals(shutdown["cleanupTasks"][0].timeout, 30000); // Default 30s
});

Deno.test("GracefulShutdown: logs shutdown progress", async () => {
  const mockLogger = createMockLogger();

  const shutdown = new GracefulShutdown(mockLogger);

  const task = spy(async () => {
    await Promise.resolve();
  });
  shutdown.registerCleanup("test-task", task);

  await shutdown.shutdown(0, false);

  // Should log: starting shutdown, running task, task completed, shutdown completed
  assertSpyCalls(mockLogger.info, 4);
  assertEquals(mockLogger.info.calls[0].args[0], "Starting graceful shutdown");
  assertEquals(mockLogger.info.calls[2].args[0], "Cleanup completed: test-task");
  assertEquals(mockLogger.info.calls[3].args[0], "Graceful shutdown completed successfully");
});

Deno.test("GracefulShutdown: handles cleanup timeout", async () => {
  const mockLogger = createMockLogger();

  const shutdown = new GracefulShutdown(mockLogger);

  let resolveHangingTask: (() => void) | undefined;
  const hangingTaskPromise = new Promise<void>((resolve) => {
    resolveHangingTask = resolve;
  });

  // Task that hangs until we resolve it
  const hangingTask = spy(async () => {
    await hangingTaskPromise;
  });

  // Short timeout
  shutdown.registerCleanup("hanging-task", hangingTask, 10);

  // We expect this to take ~10ms+ (timeout)
  await shutdown.shutdown(0, false);

  // Should have logged an error about timeout
  const errorCalls = mockLogger.error.calls;
  const timeoutError = errorCalls.find((call) =>
    typeof call.args[0] === "string" && call.args[0].includes("timed out")
  );

  assert(timeoutError !== undefined, "Expected a timeout error to be logged");
  assertEquals(timeoutError.args[0], "Cleanup timed out: hanging-task");

  // Cleanup the hanging task to avoid leaks (if any ops were seemingly pending)
  if (resolveHangingTask) resolveHangingTask();
});

Deno.test("GracefulShutdown: registerSignalHandlers registers SIGINT/SIGTERM", () => {
  const mockLogger = createMockLogger();
  const shutdown = new GracefulShutdown(mockLogger);

  const addSignalSpy = spy((_signal: Deno.Signal, _handler: () => void) => {});
  const addSignalStub = stub(Deno, "addSignalListener", addSignalSpy);

  try {
    shutdown.registerSignalHandlers();

    assertSpyCalls(addSignalSpy, 2);
    const signals = addSignalSpy.calls.map((call: any) => call.args[0]);
    assert(signals.includes(TEST_SIGNAL_SIGINT));
    assert(signals.includes(TEST_SIGNAL_SIGTERM));
    assertEquals(mockLogger.info.calls[0].args[0], LOG_MSG_SIGNAL_HANDLERS_REGISTERED);
  } finally {
    addSignalStub.restore();
  }
});

Deno.test("GracefulShutdown: registerErrorHandlers registers error listeners", () => {
  const mockLogger = createMockLogger();
  const shutdown = new GracefulShutdown(mockLogger);

  const addEventSpy = spy((_type: string, _listener: EventListenerOrEventListenerObject) => {});
  const addEventStub = stub(globalThis, "addEventListener", addEventSpy);

  try {
    shutdown.registerErrorHandlers();

    assertSpyCalls(addEventSpy, 2);
    const events = addEventSpy.calls.map((call: any) => call.args[0]);
    assert(events.includes(TEST_EVENT_UNHANDLED_REJECTION));
    assert(events.includes(TEST_EVENT_ERROR));
    assertEquals(mockLogger.info.calls[0].args[0], LOG_MSG_ERROR_HANDLERS_REGISTERED);
  } finally {
    addEventStub.restore();
  }
});
