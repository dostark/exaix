/**
 * @module ErrorAnalyzer
 * @path src/tui/analytics/error_analyzer.ts
 * @description Detects and classifies error patterns in logs to aid in troubleshooting and failure analysis.
 * @architectural-layer TUI
 * * @related-files [src/tui/structured_log_viewer.ts]
 */

import { LogLevel } from "../../shared/enums.ts";
import type { IStructuredLogEntry } from "../../shared/types/logging.ts";
import type { ErrorPattern } from "./types.ts";

/**
 * Detect error patterns in logs
 */
export function detectErrorPatterns(entries: IStructuredLogEntry[]): ErrorPattern[] {
  const errorEntries = entries.filter((e) => e.level === LogLevel.ERROR || e.level === LogLevel.FATAL);

  // Group by error message pattern (simplified)
  const patterns: Record<string, {
    count: number;
    firstSeen: Date;
    lastSeen: Date;
    operations: Set<string>;
  }> = {};

  for (const entry of errorEntries) {
    const pattern = entry.error?.message || entry.message;
    const operation = entry.context.operation || "unknown";
    const timestamp = new Date(entry.timestamp);

    if (!patterns[pattern]) {
      patterns[pattern] = {
        count: 0,
        firstSeen: timestamp,
        lastSeen: timestamp,
        operations: new Set(),
      };
    }

    patterns[pattern].count++;
    patterns[pattern].operations.add(operation);

    if (timestamp < patterns[pattern].firstSeen) {
      patterns[pattern].firstSeen = timestamp;
    }
    if (timestamp > patterns[pattern].lastSeen) {
      patterns[pattern].lastSeen = timestamp;
    }
  }

  return Object.entries(patterns).map(([pattern, data]) => ({
    pattern,
    count: data.count,
    firstSeen: data.firstSeen,
    lastSeen: data.lastSeen,
    affectedOperations: Array.from(data.operations),
  })).sort((a, b) => b.count - a.count);
}
