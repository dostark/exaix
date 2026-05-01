/**
 * @module AnalyticsQueriesTest
 * @path tests/tui/analytics/queries_test.ts
 * @description Verifies the logic for trace and log retrieval in the TUI analytics layer,
 * ensuring correct filtering by correlation identifiers and agent IDs.
 */

import { assertEquals } from "@std/assert";
import type { IStructuredLogEntry } from "@exaix/core/logger/structured_logger.ts";
import { LogLevel } from "@exaix/core";
import {
  findAgentLogs,
  findRelatedLogs,
  findTraceLogs,
  groupByCorrelation,
  groupByTrace,
} from "../../../src/tui/analytics/queries.ts";

function createLogEntry(id: number, context: IStructuredLogEntry["context"]): IStructuredLogEntry {
  return {
    timestamp: new Date(1700000000000 + id).toISOString(),
    level: LogLevel.INFO,
    message: `m-${id}`,
    context,
  };
}

Deno.test("queries.findRelatedLogs filters by correlation_id", () => {
  const entries = [
    createLogEntry(1, { correlation_id: "c1" }),
    createLogEntry(2, { correlation_id: "c2" }),
    createLogEntry(3, { correlation_id: "c1" }),
  ];

  const result = findRelatedLogs(entries, "c1");
  assertEquals(result.map((e) => e.message), ["m-1", "m-3"]);
});

Deno.test("queries.findTraceLogs filters by trace_id", () => {
  const entries = [
    createLogEntry(1, { trace_id: "t1" }),
    createLogEntry(2, { trace_id: "t2" }),
  ];

  const result = findTraceLogs(entries, "t2");
  assertEquals(result.map((e) => e.message), ["m-2"]);
});

Deno.test("queries.findAgentLogs filters by identity_id", () => {
  const entries = [
    createLogEntry(1, { identity_id: "a1" }),
    createLogEntry(2, { identity_id: "a2" }),
    createLogEntry(3, { identity_id: "a1" }),
  ];

  const result = findAgentLogs(entries, "a1");
  assertEquals(result.map((e) => e.message), ["m-1", "m-3"]);
});

Deno.test("queries.groupByCorrelation groups and uses no-correlation fallback", () => {
  const entries = [
    createLogEntry(1, { correlation_id: "c1" }),
    createLogEntry(2, {}),
    createLogEntry(3, { correlation_id: "c1" }),
  ];

  const result = groupByCorrelation(entries);
  assertEquals(Object.keys(result).sort(), ["c1", "no-correlation"]);
  assertEquals(result["c1"].length, 2);
  assertEquals(result["no-correlation"].length, 1);
});

Deno.test("queries.groupByTrace groups and uses no-trace fallback", () => {
  const entries = [
    createLogEntry(1, { trace_id: "t1" }),
    createLogEntry(2, {}),
    createLogEntry(3, { trace_id: "t1" }),
  ];

  const result = groupByTrace(entries);
  assertEquals(Object.keys(result).sort(), ["no-trace", "t1"]);
  assertEquals(result["t1"].length, 2);
  assertEquals(result["no-trace"].length, 1);
});
