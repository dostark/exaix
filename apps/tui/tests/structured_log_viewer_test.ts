/**
 * @module StructuredLogViewerTest
 * @path apps/tui/tests/structured_log_viewer_test.ts
 * @related-files []
 * @architectural-layer TUI
 * @description Suite for the StructuredLogViewer TUI, verifying tree-based navigation of trace logs,
 * grouping toggle functionality, and efficient rendering of nested activity hierarchies.
 */

import { assert, assertEquals, assertExists } from "@std/assert";
import { StructuredLogViewer } from "../src/structured_log_viewer.ts";
import type { ILogger, ILogService } from "@exaix/core/types";
import type { ILogContext, IStructuredLogEntry, LogQueryOptions } from "@exaix/core/types";
import type { LogMetadata } from "@exaix/core/types";
import { LogLevel } from "@exaix/core";
import { KEYS } from "@exaix/tui/helpers/keyboard.ts";
import { InputDialog } from "@exaix/tui/helpers/dialog_base.ts";

class MockLogService implements ILogService {
  logs: IStructuredLogEntry[] = [];
  subscribers: ((entry: IStructuredLogEntry) => void)[] = [];

  constructor(initialLogs: IStructuredLogEntry[] = []) {
    this.logs = initialLogs;
  }

  getStructuredLogs(_options: LogQueryOptions): Promise<IStructuredLogEntry[]> {
    return Promise.resolve(this.logs);
  }

  subscribeToLogs(callback: (entry: IStructuredLogEntry) => void): () => void {
    this.subscribers.push(callback);
    return () => {
      this.subscribers = this.subscribers.filter((s) => s !== callback);
    };
  }

  getLogsByCorrelationId(correlationId: string): Promise<IStructuredLogEntry[]> {
    return Promise.resolve(this.logs.filter((l) => l.context.correlation_id === correlationId));
  }

  getLogsByTraceId(traceId: string): Promise<IStructuredLogEntry[]> {
    return Promise.resolve(this.logs.filter((l) => l.context.trace_id === traceId));
  }

  getLogsByAgentId(identityId: string): Promise<IStructuredLogEntry[]> {
    return Promise.resolve(this.logs.filter((l) => l.context.identity_id === identityId));
  }

  exportLogs(_filename: string, _entries: IStructuredLogEntry[]): Promise<void> {
    return Promise.resolve();
  }

  // Helper for tests
  emit(entry: IStructuredLogEntry) {
    this.subscribers.forEach((s) => s(entry));
  }
}

class MockStructuredLogger implements ILogger {
  setContext(_context: Partial<ILogContext>): void {}
  child(_additionalContext: Partial<ILogContext>): ILogger {
    return this;
  }
  debug(_message: string, _metadata?: LogMetadata): void {}
  info(_message: string, _metadata?: LogMetadata): void {}
  warn(_message: string, _metadata?: LogMetadata): void {}
  error(_message: string, _error?: Error, _metadata?: LogMetadata): void {}
  fatal(_message: string, _error?: Error, _metadata?: LogMetadata): void {}
  time<T>(_operation: string, fn: () => Promise<T>, _metadata?: LogMetadata): Promise<T> {
    return fn();
  }
}

const createTestLogs = (count: number): IStructuredLogEntry[] => {
  return Array.from({ length: count }, (_, i) => ({
    timestamp: new Date(Date.now() - i * 60000).toISOString(),
    level: i % 5 === 0 ? LogLevel.ERROR : LogLevel.INFO,
    message: `Log message ${i}`,
    context: {
      trace_id: `trace-${i % 3}`,
      correlation_id: `corr-${i % 2}`,
      identity_id: `agent-${i % 2}`,
    },
    metadata: {},
  }));
};

Deno.test("StructuredLogViewer: Initialization", async () => {
  const logs = createTestLogs(10);
  const service = new MockLogService(logs);
  const logger = new MockStructuredLogger();
  const viewer = new StructuredLogViewer(service, logger, { testMode: true });

  await viewer.initialize();

  // Access state via public getter instead of 'any' cast
  const state = viewer.getTreeState();
  assertEquals(state.tree.length, 2); // 2 correlation groups
});

Deno.test("StructuredLogViewer: Navigation", async () => {
  const logs = createTestLogs(5);
  const service = new MockLogService(logs);
  const logger = new MockStructuredLogger();
  const viewer = new StructuredLogViewer(service, logger, { testMode: true });
  await viewer.initialize();

  // Initial selection
  const state = viewer.getTreeState();
  assertExists(state.selectedId);
  const firstId = state.selectedId;

  // Move down
  await viewer.handleKey(KEYS.DOWN);
  assert(state.selectedId !== firstId);
});

Deno.test("StructuredLogViewer: Grouping toggles", async () => {
  const logs = createTestLogs(5);
  const service = new MockLogService(logs);
  const logger = new MockStructuredLogger();
  const viewer = new StructuredLogViewer(service, logger, { testMode: true });
  await viewer.initialize();

  const extensions = viewer.getExtensions();
  assertEquals(extensions.groupBy, "correlation");

  await viewer.handleKey(KEYS.G);
  assertEquals(extensions.groupBy, "trace");

  // Verify tree structure changed
  const state = viewer.getTreeState();
  // With 5 logs and trace grouping (traces are trace-0, trace-1, trace-2)
  // We expect 3 groups
  assertEquals(state.tree.length, 3);
});

Deno.test("StructuredLogViewer: Real-time updates", async () => {
  const logs = createTestLogs(0);
  const service = new MockLogService(logs);
  const logger = new MockStructuredLogger();
  const viewer = new StructuredLogViewer(service, logger, { testMode: true }); // autoRefresh disabled in testMode

  // Manually enable realTime for this test if needed, but handleNewLogEntry is relevant
  // However, testMode disables realTime setup in constructor.
  // We can manually enable it or just test handleNewLogEntry via public/protected mechanism?
  // Or just call toggleRealTime() to enable subscription.
  viewer.toggleRealTime();

  await viewer.initialize();

  const extensions = viewer.getExtensions();
  assertEquals(extensions.logEntries.length, 0);

  const newLog: IStructuredLogEntry = {
    timestamp: new Date().toISOString(),
    level: LogLevel.INFO,
    message: "New real-time log",
    context: { correlation_id: "corr-new" },
    metadata: {},
  };

  service.emit(newLog);

  assertEquals(extensions.logEntries.length, 1);
  assertEquals(extensions.logEntries[0].message, "New real-time log");
});

Deno.test("StructuredLogViewer: Search and Filter", async () => {
  const logs = createTestLogs(10);
  const service = new MockLogService(logs);
  const logger = new MockStructuredLogger();
  const viewer = new StructuredLogViewer(service, logger, { testMode: true });
  await viewer.initialize();

  // Open search dialog
  await viewer.handleKey(KEYS.S);

  const dialog = viewer.getActiveDialog();
  assertExists(dialog);
  // Verify dialog title by rendering
  // dialog.render needs options
  const rendered = dialog.render({ useColors: false, width: 80, height: 20 }).join(" ");
  assert(rendered.includes("Search Logs"));

  // Check input interaction works using viewer.handleKey to ensure lifecycle events fire
  if (dialog instanceof InputDialog) {
    // We can just bypass InputDialog complexity if we want, or simulate keys
    // Let's simulate keys to be thorough but safe
    await viewer.handleKey(KEYS.ENTER); // Start editing
    // Type "message 0" which uniquely matches "Log message 0"
    await viewer.handleKey("m");
    await viewer.handleKey("e");
    await viewer.handleKey("s");
    await viewer.handleKey("s");
    await viewer.handleKey("a");
    await viewer.handleKey("g");
    await viewer.handleKey("e");
    await viewer.handleKey(" ");
    await viewer.handleKey("0");
    await viewer.handleKey(KEYS.ENTER); // Stop editing
    await viewer.handleKey(KEYS.ENTER); // Confirm dialog
  }

  // Ensure filter applied
  const state = viewer.getTreeState();
  assertEquals(state.filterText, "message 0");
  const extensions = viewer.getExtensions();
  // Should match "Log message 0"
  assertEquals(extensions.filteredEntries.length, 1);
  assertEquals(extensions.filteredEntries[0].message, "Log message 0");
});

Deno.test("StructuredLogViewer: Detail View", async () => {
  const logs = createTestLogs(1);
  const service = new MockLogService(logs);
  const logger = new MockStructuredLogger();
  const viewer = new StructuredLogViewer(service, logger, { testMode: true });
  await viewer.initialize();

  // Select the item (it's inside a group, so expand group first)
  const state = viewer.getTreeState();
  // Flatten tree to find the log node
  // "correlation-0" group -> log node
  // Navigate to group
  state.selectedId = state.tree[0].id; // group
  await viewer.handleKey(KEYS.RIGHT); // Expand

  // Now select child
  // Assuming group expansion injects children or tree structure handles it.
  // BaseTreeView helper 'toggleNode' updates tree correctly.

  // Let's just find the log node ID and select it directly for testing detail view
  // skipping navigation details which are tested in BaseTreeView tests
  const logNodeId = logs[0].timestamp;
  viewer.setSelectedId(logNodeId);

  // View details
  await viewer.handleKey(KEYS.ENTER);
  const extensions = viewer.getExtensions();
  assert(extensions.showDetail);
  assert(extensions.detailContent.includes("Log message 0"));

  // Close details
  await viewer.handleKey(KEYS.ESCAPE);
  assert(!extensions.showDetail);
});

Deno.test("StructuredLogViewer: Format Entry", () => {
  // Test formatting logic
  const service = new MockLogService([]);
  const logger = new MockStructuredLogger();
  const viewer = new StructuredLogViewer(service, logger, { testMode: true });

  const entry: IStructuredLogEntry = {
    timestamp: "2024-01-01T12:00:00Z",
    level: LogLevel.WARN,
    message: "Test message",
    context: { trace_id: "abcdef123456" },
  };

  const formatted = viewer.formatLogEntryForTest(entry);
  assert(formatted.includes("WARN"));
  assert(formatted.includes("Test message"));
  assert(formatted.includes("trace=abcdef12"));
});
