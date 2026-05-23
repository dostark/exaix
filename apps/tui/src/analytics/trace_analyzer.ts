/**
 * @module TraceAnalyzer
 * @path apps/tui/src/analytics/trace_analyzer.ts
 * @description Analyzes system traces to visualize the sequence of operations and identify bottlenecks or failures.
 * @architectural-layer TUI
 * @related-files [apps/tui/src/structured_log_viewer.ts]
 */

import type { IStructuredLogEntry } from "@exaix/core/types";
import type { TraceAnalysis } from "./types.ts";
import { LogLevel } from "@exaix/core";

/**
 * Analyze a trace through the system
 */
export function analyzeTrace(entries: IStructuredLogEntry[]): TraceAnalysis | null {
  if (entries.length === 0) return null;

  // Find common trace ID
  const traceIds = new Set(entries.map((e) => e.context.trace_id).filter(Boolean));
  if (traceIds.size !== 1) return null;

  const traceId = Array.from(traceIds)[0]!;

  // Find correlation ID (may be null)
  const correlationIds = new Set(entries.map((e) => e.context.correlation_id).filter(Boolean));
  const correlationId = correlationIds.size === 1 ? Array.from(correlationIds)[0] : undefined;

  // Sort entries by timestamp
  const sortedEntries = entries.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  const operations = sortedEntries.map((entry) => ({
    operation: entry.context.operation || "unknown",
    timestamp: new Date(entry.timestamp),
    duration: entry.performance?.duration_ms,
    identityId: entry.context.identity_id,
    level: entry.level,
    message: entry.message,
  }));

  // Time analysis
  const start = operations[0].timestamp;
  const end = operations[operations.length - 1].timestamp;
  const duration = end.getTime() - start.getTime();

  // Error analysis
  const errorCount = operations.filter((op) => op.level === LogLevel.ERROR || op.level === LogLevel.FATAL).length;
  const success = errorCount === 0;

  return {
    traceId,
    correlationId,
    operations,
    timeSpan: { start, end, duration },
    errorCount,
    success,
  };
}
