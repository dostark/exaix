/**
 * @module TrajectoryCaptureTest
 * @path tests/scenario_framework/tests/unit/trajectory_capture_test.ts
 * @description Tests that captureToolCallsFromJournal returns the correct
 * ordered tool sequence from fixture journal rows with action_type =
 * "dynamic_tool_call" and payload: {tool, args}, and that rows outside
 * the rowid window are excluded.
 */

import { assertEquals } from "@std/assert";
import { Database } from "@db/sqlite";
import { ACTIVITY_EVENT_DYNAMIC_TOOL_CALL } from "@exaix/core";
import type { JSONValue } from "@exaix/core";
import { captureToolCallsFromJournal } from "../../runner/trajectory_evaluator.ts";

interface IFixtureJournalRow {
  rowid: number;
  actionType: string;
  payload: Record<string, JSONValue>;
}

function createFixtureJournal(rows: IFixtureJournalRow[]): string {
  const path = Deno.makeTempDirSync();
  const dbPath = `${path}/journal.db`;
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS activity (
      rowid INTEGER PRIMARY KEY AUTOINCREMENT,
      action_type TEXT NOT NULL,
      payload TEXT
    )
  `);
  const insert = db.prepare("INSERT INTO activity (rowid, action_type, payload) VALUES (?, ?, ?)");
  for (const row of rows) {
    insert.run(row.rowid, row.actionType, JSON.stringify(row.payload));
  }
  insert.finalize();
  db.close();
  return dbPath;
}

Deno.test("[TrajectoryCapture] returns ordered tool calls from dynamic_tool_call rows", () => {
  const dbPath = createFixtureJournal([
    { rowid: 1, actionType: "daemon.start", payload: {} },
    {
      rowid: 2,
      actionType: ACTIVITY_EVENT_DYNAMIC_TOOL_CALL,
      payload: { tool: "read_file", args: { path: "/tmp/a" } },
    },
    {
      rowid: 3,
      actionType: ACTIVITY_EVENT_DYNAMIC_TOOL_CALL,
      payload: { tool: "edit_file", args: { path: "/tmp/a", content: "x" } },
    },
    { rowid: 4, actionType: ACTIVITY_EVENT_DYNAMIC_TOOL_CALL, payload: { tool: "bash", args: { command: "ls" } } },
    { rowid: 5, actionType: "daemon.ready", payload: {} },
  ]);

  const result = captureToolCallsFromJournal(dbPath, { sinceRowid: 0, untilRowid: 100 });
  assertEquals(result.sequence, ["read_file", "edit_file", "bash"]);
  Deno.removeSync(dbPath, { recursive: true });
});

Deno.test("[TrajectoryCapture] excludes rows outside rowid window", () => {
  const dbPath = createFixtureJournal([
    { rowid: 10, actionType: ACTIVITY_EVENT_DYNAMIC_TOOL_CALL, payload: { tool: "early", args: {} } },
    { rowid: 20, actionType: ACTIVITY_EVENT_DYNAMIC_TOOL_CALL, payload: { tool: "middle", args: {} } },
    { rowid: 30, actionType: ACTIVITY_EVENT_DYNAMIC_TOOL_CALL, payload: { tool: "late", args: {} } },
  ]);

  const result = captureToolCallsFromJournal(dbPath, { sinceRowid: 15, untilRowid: 25 });
  assertEquals(result.sequence, ["middle"]);
  Deno.removeSync(dbPath, { recursive: true });
});

Deno.test("[TrajectoryCapture] returns empty sequence when no matching events", () => {
  const dbPath = createFixtureJournal([
    { rowid: 1, actionType: "daemon.start", payload: {} },
    { rowid: 2, actionType: "daemon.ready", payload: {} },
  ]);

  const result = captureToolCallsFromJournal(dbPath, { sinceRowid: 0, untilRowid: 100 });
  assertEquals(result.sequence, []);
  assertEquals(result.matchedCount, 0);
  Deno.removeSync(dbPath, { recursive: true });
});

Deno.test("[TrajectoryCapture] returns empty sequence on missing DB (ERROR criterion, not crash)", () => {
  const result = captureToolCallsFromJournal("/nonexistent/path.db", { sinceRowid: 0, untilRowid: 100 });
  assertEquals(result.sequence, []);
  assertEquals(result.error, true);
});

Deno.test("[TrajectoryCapture] extracts tool and args from payload JSON column", () => {
  const dbPath = createFixtureJournal([
    {
      rowid: 1,
      actionType: ACTIVITY_EVENT_DYNAMIC_TOOL_CALL,
      payload: { tool: "search_code", args: { pattern: "foo", path: "/src" } },
    },
  ]);

  const result = captureToolCallsFromJournal(dbPath, { sinceRowid: 0, untilRowid: 100 });
  assertEquals(result.sequence, ["search_code"]);
  assertEquals(result.toolCalls.length, 1);
  assertEquals(result.toolCalls[0].tool, "search_code");
  assertEquals(result.toolCalls[0].args.pattern, "foo");
  Deno.removeSync(dbPath, { recursive: true });
});
