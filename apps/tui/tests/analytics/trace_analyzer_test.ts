/**
 * @module TraceAnalyzerTest
 * @path apps/tui/tests/analytics/trace_analyzer_test.ts
 * @related-files []
 * @architectural-layer TUI
 * @description Verifies the logic for multi-step trace analysis, ensuring complex agent
 * execution paths are correctly reconstructed and validated from flat log entries.
 */

import { assertEquals, assertExists } from "@std/assert";

import { analyzeTrace } from "../../src/analytics/trace_analyzer.ts";
import type { IStructuredLogEntry } from "@exaix/core/logger";
import { LogLevel } from "@exaix/core";

function entry(params: {
  timestamp: string;
  level: IStructuredLogEntry["level"];
  traceId?: string;
  correlationId?: string;
  operation?: string;
  durationMs?: number;
}): IStructuredLogEntry {
  return {
    timestamp: new Date(params.timestamp).toISOString(),
    level: params.level,
    message: "m",
    context: {
      trace_id: params.traceId,
      correlation_id: params.correlationId,
      operation: params.operation,
    },
    performance: params.durationMs !== undefined ? { duration_ms: params.durationMs } : undefined,
  } as IStructuredLogEntry;
}

Deno.test("analyzeTrace: returns null for empty entries", () => {
  assertEquals(analyzeTrace([]), null);
});

Deno.test("analyzeTrace: returns null when trace_id set is not exactly 1", () => {
  const result = analyzeTrace([
    entry({ timestamp: "2024-01-01T00:00:00Z", level: LogLevel.INFO, traceId: "t1" }),
    entry({ timestamp: "2024-01-01T00:00:01Z", level: LogLevel.INFO, traceId: "t2" }),
  ]);

  assertEquals(result, null);
});

Deno.test("analyzeTrace: correlationId undefined when multiple correlation IDs", () => {
  const result = analyzeTrace([
    entry({ timestamp: "2024-01-01T00:00:00Z", level: LogLevel.INFO, traceId: "t", correlationId: "c1" }),
    entry({ timestamp: "2024-01-01T00:00:01Z", level: LogLevel.INFO, traceId: "t", correlationId: "c2" }),
  ]);

  assertExists(result);
  assertEquals(result.correlationId, undefined);
});

Deno.test("analyzeTrace: sorts operations and computes errorCount/success", () => {
  const result = analyzeTrace([
    entry({
      timestamp: "2024-01-01T00:00:02Z",
      level: LogLevel.ERROR,
      traceId: "t",
      correlationId: "c",
      operation: "b",
    }),
    entry({
      timestamp: "2024-01-01T00:00:00Z",
      level: LogLevel.INFO,
      traceId: "t",
      correlationId: "c",
      operation: "a",
    }),
    entry({
      timestamp: "2024-01-01T00:00:01Z",
      level: LogLevel.FATAL,
      traceId: "t",
      correlationId: "c",
      operation: "c",
    }),
  ]);

  assertExists(result);
  assertEquals(result.traceId, "t");
  assertEquals(result.correlationId, "c");

  assertEquals(result.operations[0].operation, "a");
  assertEquals(result.operations[1].operation, "c");
  assertEquals(result.operations[2].operation, "b");

  assertEquals(result.errorCount, 2);
  assertEquals(result.success, false);
  assertEquals(result.timeSpan.duration, 2000);
});
