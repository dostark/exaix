/**
 * @module LogCorrelationTest
 * @path apps/tui/tests/log_correlation_test.ts
 * @related-files []
 * @architectural-layer TUI
 * @description Verifies the logic for trace and correlation analysis in the TUI, ensuring
 * related activity logs are correctly grouped across asynchronous agent execution boundaries.
 */

import { assertEquals, assertExists } from "@std/assert";
import { analyzeCorrelation } from "../src/analytics/correlation_analyzer.ts";
import { analyzeTrace } from "../src/analytics/trace_analyzer.ts";
import { calculatePerformanceStats } from "../src/analytics/performance_analyzer.ts";
import { detectErrorPatterns } from "../src/analytics/error_analyzer.ts";
import { findRelatedLogs, findTraceLogs, groupByCorrelation } from "../src/analytics/queries.ts";
import type { IStructuredLogEntry } from "@exaix/core/logger";
import { LogLevel } from "@exaix/core";

// Helper to create mock log entries
function createLogEntry(
  id: number,
  timestamp: string,
  level: LogLevel,
  context: {
    correlation_id?: string;
    trace_id?: string;
    identity_id?: string;
    operation?: string;
  } = {},
  performance?: { duration_ms: number },
  error?: { message: string },
): IStructuredLogEntry {
  return {
    timestamp: new Date(timestamp).toISOString(),
    level: level,
    message: `Log message ${id}`,
    context: {
      ...context,
      // hostname removed as it's not in IStructuredLogEntry type
    },
    performance,
    error: error
      ? {
        name: "Error",
        message: error.message,
      }
      : undefined,
  };
}

Deno.test("[analyzeCorrelation] analyzes correlation correctly", () => {
  const entries = [
    createLogEntry(1, "2024-01-01T10:00:00Z", LogLevel.INFO, {
      correlation_id: "corr-1",
      trace_id: "trace-1",
      identity_id: "agent-1",
      operation: "op-1",
    }, { duration_ms: 100 }),
    createLogEntry(2, "2024-01-01T10:00:01Z", LogLevel.INFO, {
      correlation_id: "corr-1",
      trace_id: "trace-2",
      identity_id: "agent-1",
      operation: "op-2",
    }, { duration_ms: 200 }),
  ];

  const result = analyzeCorrelation(entries);

  assertExists(result);
  assertEquals(result.correlationId, "corr-1");
  assertEquals(result.entryCount, 2);
  assertEquals(result.timeSpan.duration, 1000);
  assertEquals(result.performanceStats?.avgDuration, 150);
  assertEquals(result.traceIds, ["trace-1", "trace-2"]);
  assertEquals(result.operations, ["op-1", "op-2"]);
});

Deno.test("[analyzeCorrelation] returns null mixed correlation IDs", () => {
  const entries = [
    createLogEntry(1, "2024-01-01T10:00:00Z", LogLevel.INFO, { correlation_id: "corr-1" }),
    createLogEntry(2, "2024-01-01T10:00:01Z", LogLevel.INFO, { correlation_id: "corr-2" }),
  ];

  const result = analyzeCorrelation(entries);
  assertEquals(result, null);
});

Deno.test("[analyzeTrace] analyzes trace correctly", () => {
  const entries = [
    createLogEntry(2, "2024-01-01T10:00:01Z", LogLevel.INFO, {
      trace_id: "trace-1",
      correlation_id: "corr-1",
      operation: "step-2",
    }),
    createLogEntry(1, "2024-01-01T10:00:00Z", LogLevel.INFO, {
      trace_id: "trace-1",
      correlation_id: "corr-1",
      operation: "step-1",
    }),
  ];

  const result = analyzeTrace(entries);

  assertExists(result);
  assertEquals(result.traceId, "trace-1");
  assertEquals(result.correlationId, "corr-1");
  assertEquals(result.operations.length, 2);
  // Should be sorted by timestamp
  assertEquals(result.operations[0].operation, "step-1");
  assertEquals(result.operations[1].operation, "step-2");
  assertEquals(result.timeSpan.duration, 1000);
});

Deno.test("[findRelatedLogs] filters by correlation ID", () => {
  const entries = [
    createLogEntry(1, "2024-01-01T10:00:00Z", LogLevel.INFO, { correlation_id: "c1" }),
    createLogEntry(2, "2024-01-01T10:00:01Z", LogLevel.INFO, { correlation_id: "c2" }),
    createLogEntry(3, "2024-01-01T10:00:02Z", LogLevel.INFO, { correlation_id: "c1" }),
  ];

  const result = findRelatedLogs(entries, "c1");
  assertEquals(result.length, 2);
  assertEquals(result[0].context.correlation_id, "c1");
  assertEquals(result[1].context.correlation_id, "c1");
});

Deno.test("[findTraceLogs] filters by trace ID", () => {
  const entries = [
    createLogEntry(1, "2024-01-01T10:00:00Z", LogLevel.INFO, { trace_id: "t1" }),
    createLogEntry(2, "2024-01-01T10:00:01Z", LogLevel.INFO, { trace_id: "t2" }),
  ];

  const result = findTraceLogs(entries, "t1");
  assertEquals(result.length, 1);
  assertEquals(result[0].context.trace_id, "t1");
});

Deno.test("[groupByCorrelation] groups correctly", () => {
  const entries = [
    createLogEntry(1, "2024-01-01T10:00:00Z", LogLevel.INFO, { correlation_id: "c1" }),
    createLogEntry(2, "2024-01-01T10:00:01Z", LogLevel.INFO, { correlation_id: "c2" }),
    createLogEntry(3, "2024-01-01T10:00:02Z", LogLevel.INFO, { correlation_id: "c1" }),
  ];

  const result = groupByCorrelation(entries);
  assertEquals(Object.keys(result).length, 2);
  assertEquals(result["c1"].length, 2);
  assertEquals(result["c2"].length, 1);
});

Deno.test("[calculatePerformanceStats] calculates stats correctly", () => {
  const entries = [
    createLogEntry(1, "2024-01-01T10:00:00Z", LogLevel.INFO, {}, { duration_ms: 100 }),
    createLogEntry(2, "2024-01-01T10:00:01Z", LogLevel.INFO, {}, { duration_ms: 200 }),
    createLogEntry(3, "2024-01-01T10:00:02Z", LogLevel.INFO, {}, { duration_ms: 300 }),
    createLogEntry(4, "2024-01-01T10:00:03Z", LogLevel.ERROR, {}, { duration_ms: 400 }),
  ];

  const result = calculatePerformanceStats(entries);
  assertExists(result);
  assertEquals(result.totalOperations, 4);
  assertEquals(result.avgDuration, 250);
  assertEquals(result.minDuration, 100);
  assertEquals(result.maxDuration, 400);
  assertEquals(result.errorRate, 0.25);
});

Deno.test("[detectErrorPatterns] patterns correctly", () => {
  const entries = [
    createLogEntry(1, "2024-01-01T10:00:00Z", LogLevel.ERROR, { operation: "op-1" }, undefined, { message: "timeout" }),
    createLogEntry(2, "2024-01-01T10:00:01Z", LogLevel.ERROR, { operation: "op-2" }, undefined, { message: "timeout" }),
    createLogEntry(3, "2024-01-01T10:00:02Z", LogLevel.ERROR, { operation: "op-3" }, undefined, {
      message: "connection refused",
    }),
  ];

  const result = detectErrorPatterns(entries);
  assertEquals(result.length, 2);

  const timeoutPattern = result.find((p) => p.pattern === "timeout");
  assertExists(timeoutPattern);
  assertEquals(timeoutPattern.count, 2);

  const connectionPattern = result.find((p) => p.pattern === "connection refused");
  assertExists(connectionPattern);
  assertEquals(connectionPattern.count, 1);
});
