/**
 * @module CorrelationAnalyzer
 * @path src/tui/analytics/correlation_analyzer.ts
 * @description Analyzes correlation across multiple log entries to identify related operations and system flows.
 * @architectural-layer TUI
 * @related-files [src/tui/structured_log_viewer.ts]
 */

import type { IStructuredLogEntry } from "@exaix/core/types";
import type { CorrelationAnalysis } from "./types.ts";
import { LogLevel } from "@exaix/core";

/**
 * Analyze correlation across multiple log entries
 */
export function analyzeCorrelation(entries: IStructuredLogEntry[]): CorrelationAnalysis | null {
  if (entries.length === 0) return null;

  // Find common correlation ID
  const correlationIds = new Set(entries.map((e) => e.context.correlation_id).filter(Boolean));
  if (correlationIds.size !== 1) return null;

  const correlationId = Array.from(correlationIds)[0]!;

  // Extract metadata
  const traceIds = new Set(entries.map((e) => e.context.trace_id).filter(Boolean));
  const identityIds = new Set(entries.map((e) => e.context.identity_id).filter(Boolean));
  const operations = new Set(entries.map((e) => e.context.operation).filter(Boolean));

  // Time analysis
  const timestamps = entries.map((e) => new Date(e.timestamp));
  const start = new Date(Math.min(...timestamps.map((t) => t.getTime())));
  const end = new Date(Math.max(...timestamps.map((t) => t.getTime())));
  const duration = end.getTime() - start.getTime();

  // Error analysis
  const errorCount = entries.filter((e) => e.level === LogLevel.ERROR || e.level === LogLevel.FATAL).length;

  // Performance analysis
  const performanceEntries = entries.filter((e) => e.performance?.duration_ms);
  let performanceStats;
  if (performanceEntries.length > 0) {
    const durations = performanceEntries.map((e) => e.performance!.duration_ms!);
    performanceStats = {
      totalDuration: durations.reduce((sum, d) => sum + d, 0),
      avgDuration: durations.reduce((sum, d) => sum + d, 0) / durations.length,
      maxDuration: Math.max(...durations),
      minDuration: Math.min(...durations),
    };
  }

  return {
    correlationId,
    traceIds: Array.from(traceIds).filter(Boolean) as string[],
    identityIds: Array.from(identityIds).filter(Boolean) as string[],
    operations: Array.from(operations).filter(Boolean) as string[],
    timeSpan: { start, end, duration },
    entryCount: entries.length,
    errorCount,
    performanceStats,
  };
}
