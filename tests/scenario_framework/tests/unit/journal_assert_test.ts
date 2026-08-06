/**
 * @module ScenarioFrameworkJournalAssertTest
 * @path tests/scenario_framework/tests/unit/journal_assert_test.ts
 * @description Tests for the `journal-assert` step type — a declarative SQL assertion against the
 *   workspace journal (native @db/sqlite). `$TRACE_ID` is substituted with the current request's
 *   trace so the assertion is scoped to THIS scenario (never an earlier scenario's rows in a
 *   shared sandbox); the query must return a row when the assertion holds.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/step_executor.ts, tests/scenario_framework/schema/step_schema.ts]
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { Database } from "@db/sqlite";
import { executeScenarioStep } from "../../runner/step_executor.ts";
import { ScenarioStepType } from "../../schema/step_schema.ts";

function journalAssertStep(query: string) {
  return {
    id: "journal-assert",
    type: ScenarioStepType.JOURNAL_ASSERT,
    args: [query],
    input_criteria: [],
    output_criteria: [],
    continue_on_failure: false,
  } as never;
}

async function withJournal(fn: (ws: string) => Promise<void>): Promise<void> {
  const ws = await Deno.makeTempDir({ prefix: "journal-assert-" });
  try {
    await Deno.mkdir(join(ws, ".exa"), { recursive: true });
    const db = new Database(join(ws, ".exa", "journal.db"));
    db.prepare(
      "CREATE TABLE activity (rowid INTEGER PRIMARY KEY, trace_id TEXT, action_type TEXT, payload TEXT)",
    ).run();
    db.prepare(
      "INSERT INTO activity (trace_id, action_type, payload) VALUES ('trace-1', 'request.created', '{}'), " +
        "('trace-1', 'dynamic_tool_call', '{\"tool\":\"read_file\"}'), ('trace-2', 'request.created', '{}')",
    ).run();
    db.close();
    await fn(ws);
  } finally {
    await Deno.remove(ws, { recursive: true });
  }
}

Deno.test("[journal_assert] a holding assertion returns a row and exits 0", async () => {
  await withJournal(async (ws) => {
    const result = await executeScenarioStep({
      step: journalAssertStep(
        "SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM activity WHERE action_type = 'dynamic_tool_call' AND trace_id = '$TRACE_ID' AND payload LIKE '%write_file%')",
      ),
      cwd: ws,
    });
    assertEquals(result.exitCode, 0, `expected pass, got: ${result.stderr}`);
  });
});

Deno.test("[journal_assert] a failing assertion returns no row and exits 1", async () => {
  await withJournal(async (ws) => {
    const result = await executeScenarioStep({
      step: journalAssertStep(
        "SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM activity WHERE action_type = 'dynamic_tool_call')",
      ),
      cwd: ws,
    });
    assertEquals(result.exitCode, 1, "expected the assertion to fail");
  });
});

Deno.test("[journal_assert] $TRACE_ID scopes to the newest request's trace", async () => {
  await withJournal(async (ws) => {
    // newest request.created is trace-2, which has NO dynamic_tool_call → assertion holds.
    const result = await executeScenarioStep({
      step: journalAssertStep(
        "SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM activity WHERE action_type = 'dynamic_tool_call' AND trace_id = '$TRACE_ID')",
      ),
      cwd: ws,
    });
    assertEquals(result.exitCode, 0, `$TRACE_ID must scope to trace-2, got: ${result.stderr}`);
  });
});
