/**
 * @module PerformanceAnalyzer
 * @path apps/tui/src/analytics/performance_analyzer.ts
 * @description Calculates performance statistics (latencies, error rates) from log entries to monitor system health.
 * @architectural-layer TUI
 * @related-files [apps/tui/src/structured_log_viewer.ts]
 */

import { LogLevel } from "@exaix/core";
import type { IStructuredLogEntry } from "@exaix/core/types";
import type { PerformanceStats } from "./types.ts";

/**
 * Calculate performance statistics for a set of logs
 */
export function calculatePerformanceStats(entries: IStructuredLogEntry[]): PerformanceStats | null {
  const performanceEntries = entries.filter((e) => e.performance?.duration_ms);
  if (performanceEntries.length === 0) return null;

  const durations = performanceEntries.map((e) => e.performance!.duration_ms!);
  const sortedDurations = durations.sort((a, b) => a - b);

  const totalOperations = entries.length;
  const avgDuration = durations.reduce((sum, d) => sum + d, 0) / durations.length;
  const maxDuration = Math.max(...durations);
  const minDuration = Math.min(...durations);
  const p95Duration = sortedDurations[Math.floor(sortedDurations.length * 0.95)];

  const errorCount = entries.filter((e) => e.level === LogLevel.ERROR || e.level === LogLevel.FATAL).length;
  const errorRate = errorCount / totalOperations;

  return {
    totalOperations,
    avgDuration,
    maxDuration,
    minDuration,
    p95Duration,
    errorRate,
  };
}
