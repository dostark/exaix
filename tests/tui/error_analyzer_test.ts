/**
 * @module ErrorAnalyzerTest
 * @path tests/tui/error_analyzer_test.ts
 * @description Verifies the logic for pattern-based error analysis in the TUI, ensuring
 * frequent failure modes are correctly grouped and surfaced for debugging.
 */

import { assertEquals } from "@std/assert";
import { detectErrorPatterns } from "../../src/tui/analytics/error_analyzer.ts";
import type { IStructuredLogEntry } from "../../src/services/logger/structured_logger.ts";
import { LogLevel } from "@exaix/core";

function entry(overrides: Partial<IStructuredLogEntry>): IStructuredLogEntry {
  return {
    timestamp: overrides.timestamp ?? new Date(0).toISOString(),
    level: overrides.level ?? LogLevel.ERROR,
    message: overrides.message ?? "m",
    context: overrides.context ?? {},
    error: overrides.error,
  } as IStructuredLogEntry;
}

Deno.test("detectErrorPatterns: groups errors by message and sorts by count", () => {
  const entries: IStructuredLogEntry[] = [
    entry({
      timestamp: new Date(1).toISOString(),
      level: LogLevel.ERROR,
      message: "fallback",
      context: { operation: "op1" },
      error: { name: "E", message: "boom" },
    }),
    entry({
      timestamp: new Date(2).toISOString(),
      level: LogLevel.FATAL,
      message: "fallback",
      context: { operation: "op2" },
      error: { name: "E", message: "boom" },
    }),
    entry({
      timestamp: new Date(3).toISOString(),
      level: LogLevel.ERROR,
      message: "other",
      context: {},
    }),
  ];

  const patterns = detectErrorPatterns(entries);

  assertEquals(patterns.length, 2);
  assertEquals(patterns[0].pattern, "boom");
  assertEquals(patterns[0].count, 2);
  assertEquals(patterns[0].affectedOperations.sort(), ["op1", "op2"]);
  assertEquals(patterns[1].pattern, "other");
  assertEquals(patterns[1].affectedOperations, ["unknown"]);
});
