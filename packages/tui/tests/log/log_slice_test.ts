/**
 * @module LogSliceTest
 * @path packages/tui/tests/log/log_slice_test.ts
 * @related-files []
 * @architectural-layer TUI
 * @description Regression tests for package-owned TUI log rendering and streaming helpers.
 */

import { assert, assertEquals } from "@std/assert";
import { ConnectionStatus, LogLevel } from "@exaix/core";
import { getTheme } from "@exaix/tui/helpers/colors.ts";
import type { IStructuredLogEntry } from "@exaix/core/types";
import { renderLogEntry } from "@exaix/tui/log/renderer.ts";
import { createLogStreamManager, LogStreamManager } from "@exaix/tui/log/stream.ts";

class MockLogService {
  subscribers: Array<(entry: IStructuredLogEntry) => void> = [];

  subscribeToLogs(callback: (entry: IStructuredLogEntry) => void): () => void {
    this.subscribers.push(callback);
    return () => {
      this.subscribers = this.subscribers.filter((candidate) => candidate !== callback);
    };
  }

  emit(entry: IStructuredLogEntry): void {
    this.subscribers.forEach((subscriber) => subscriber(entry));
  }
}

function createEntry(message: string): IStructuredLogEntry {
  return {
    timestamp: "2024-01-01T12:00:00.000Z",
    level: LogLevel.INFO,
    message,
    context: {
      trace_id: "abcdef123456",
      correlation_id: "corr-123456",
    },
    metadata: {},
  };
}

Deno.test("log slice: renderLogEntry formats context and truncates long messages", () => {
  const rendered = renderLogEntry(createEntry("x".repeat(140)), {
    theme: getTheme(true),
    maxMessageLength: 20,
  });

  assert(rendered.includes("trace:abcdef12"));
  assert(rendered.includes("corr:corr-123"));
  assert(rendered.includes("..."));
});

Deno.test("log slice: LogStreamManager starts, flushes, and stops", async () => {
  const service = new MockLogService();
  const manager = new LogStreamManager(service, {
    maxBufferSize: 10,
    updateInterval: 5,
    enabled: true,
    cleanupInterval: 20,
    maxEntryAge: 1000,
  });
  const received: IStructuredLogEntry[] = [];
  manager.subscribe((entries: IStructuredLogEntry[]) => received.push(...entries));

  manager.start();
  assertEquals(manager.getState().status, ConnectionStatus.CONNECTED);

  service.emit(createEntry("streamed"));
  await new Promise((resolve) => setTimeout(resolve, 20));

  assertEquals(received.length, 1);

  manager.stop();
  assertEquals(manager.getState().status, ConnectionStatus.DISCONNECTED);
});

Deno.test("log slice: createLogStreamManager returns a disconnected manager", () => {
  const manager = createLogStreamManager(new MockLogService());
  assert(manager instanceof LogStreamManager);
  assertEquals(manager.getState().status, ConnectionStatus.DISCONNECTED);
});
