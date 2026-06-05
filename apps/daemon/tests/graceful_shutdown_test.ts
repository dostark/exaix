/**
 * @module GracefulShutdownTest
 * @path apps/daemon/tests/graceful_shutdown_test.ts
 * @description Tests for graceful shutdown behavior, including cleanup task registration,
 * LIFO execution order, timeout handling, signal registration, and error handling.
 */
import { assert, assertEquals } from "@std/assert";
import { assertSpyCalls, spy, stub } from "@std/testing/mock";
import { GracefulShutdown } from "../src/graceful_shutdown.ts";
import { createMockLogger } from "@exaix/testing";
import type { JSONValue } from "@exaix/core/types";
import {
  LOG_MSG_ERROR_HANDLERS_REGISTERED,
  LOG_MSG_SIGNAL_HANDLERS_REGISTERED,
  TEST_EVENT_ERROR,
  TEST_EVENT_UNHANDLED_REJECTION,
  TEST_SIGNAL_SIGINT,
  TEST_SIGNAL_SIGTERM,
} from "@exaix/testing";

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
  assertSpyCalls(mockLogger.error, 2);
});

Deno.test("GracefulShutdown: prevents multiple shutdown attempts", async () => {
  const mockLogger = createMockLogger();
  const shutdown = new GracefulShutdown(mockLogger);
  const task = spy(async () => {
    await Promise.resolve();
  });
  shutdown.registerCleanup("task", task);
  const shutdown1 = shutdown.shutdown(0, false);
  const shutdown2 = shutdown.shutdown(0, false);
  await Promise.all([shutdown1, shutdown2]);
  assertSpyCalls(mockLogger.warn, 1);
});

Deno.test("GracefulShutdown: uses default timeout when not specified", () => {
  const mockLogger = createMockLogger();
  const shutdown = new GracefulShutdown(mockLogger);
  const task = spy(async () => {
    await Promise.resolve();
  });
  shutdown.registerCleanup("task", task);
  assertEquals(shutdown["cleanupTasks"][0].timeout, 30000);
});

Deno.test("GracefulShutdown: logs shutdown progress", async () => {
  const mockLogger = createMockLogger();
  const shutdown = new GracefulShutdown(mockLogger);
  const task = spy(async () => {
    await Promise.resolve();
  });
  shutdown.registerCleanup("test-task", task);
  await shutdown.shutdown(0, false);

  assertSpyCalls(mockLogger.info, 4);
  assertEquals(mockLogger.info.calls[0].args[1], "Starting graceful shutdown");
  assertEquals(mockLogger.info.calls[2].args[1], "test-task");
  assertEquals(mockLogger.info.calls[3].args[1], "Graceful shutdown completed successfully");
});

Deno.test("GracefulShutdown: handles cleanup timeout", async () => {
  const mockLogger = createMockLogger();
  const shutdown = new GracefulShutdown(mockLogger);
  let resolveHangingTask: (() => void) | undefined;
  const hangingTaskPromise = new Promise<void>((resolve) => {
    resolveHangingTask = resolve;
  });
  const hangingTask = spy(async () => {
    await hangingTaskPromise;
  });
  shutdown.registerCleanup("hanging-task", hangingTask, 10);
  await shutdown.shutdown(0, false);

  const errorCalls = mockLogger.error.calls;
  const timeoutError = errorCalls.find((call) => {
    const payload = call.args[2] as Record<string, JSONValue> | undefined;
    return typeof payload === "object" && payload !== null &&
      "error" in payload &&
      typeof payload.error === "string" &&
      (payload.error as string).includes("Cleanup timeout");
  });
  assert(timeoutError !== undefined, "Expected a timeout error to be logged");

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
    const signals = addSignalSpy.calls.map((call) => call.args[0] as Deno.Signal);
    assert(signals.includes(TEST_SIGNAL_SIGINT));
    assert(signals.includes(TEST_SIGNAL_SIGTERM));
    assertEquals(mockLogger.info.calls[0].args[1], LOG_MSG_SIGNAL_HANDLERS_REGISTERED);
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
    const events = addEventSpy.calls.map((call) => call.args[0] as string);
    assert(events.includes(TEST_EVENT_UNHANDLED_REJECTION));
    assert(events.includes(TEST_EVENT_ERROR));
    assertEquals(mockLogger.info.calls[0].args[1], LOG_MSG_ERROR_HANDLERS_REGISTERED);
  } finally {
    addEventStub.restore();
  }
});
