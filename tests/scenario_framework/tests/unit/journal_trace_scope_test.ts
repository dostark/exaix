/**
 * @module ScenarioFrameworkJournalTraceScopeTest
 * @path tests/scenario_framework/tests/unit/journal_trace_scope_test.ts
 * @description Phase-197 Step 15 (GAP-8) — RED-first test for the opt-in `trace_scope: current`
 *   flag on the `journal-event-exists` criterion: matches are restricted to the CURRENT
 *   scenario request's trace (the first request.created above the scenario journal baseline),
 *   so an identical event produced by ANOTHER request's trace cannot satisfy the assertion.
 *   Without the flag, a globally found event is not evidence the request under test emitted it.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/assertions.ts, tests/scenario_framework/schema/step_schema.ts]
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { Database } from "@db/sqlite";
import { evaluateCriterion } from "../../runner/assertions.ts";
import { CriterionKind, CriterionPhase, CriterionStatus } from "../../schema/step_schema.ts";

const EVENT_REQUEST_CREATED = "request.created";
const EVENT_EFFORT_RESOLVED = "agent.effort_resolved";
const PAYLOAD_KEY_EFFORT_BASIS = "effort_basis";
const BASIS_NATIVE_ADAPTIVE = "native-adaptive";
const BASIS_HEURISTIC = "heuristic";
const TRACE_CURRENT = "trace-current";
const TRACE_OTHER = "trace-other";
const JOURNAL_FILE = "journal.ndjson";

/** The current trace (first request.created above the baseline) carries a native-adaptive
 *  resolution; a DIFFERENT trace carries an identical-looking heuristic one. A trace-scoped
 *  assertion must NOT be satisfied by the other trace's event. */
const ROWS: Array<[string, string, string]> = [
  [TRACE_CURRENT, EVENT_REQUEST_CREATED, "{}"],
  [TRACE_CURRENT, EVENT_EFFORT_RESOLVED, `{"${PAYLOAD_KEY_EFFORT_BASIS}":"${BASIS_NATIVE_ADAPTIVE}"}`],
  [TRACE_OTHER, EVENT_EFFORT_RESOLVED, `{"${PAYLOAD_KEY_EFFORT_BASIS}":"${BASIS_HEURISTIC}"}`],
];

async function withJournal(
  rows: Array<[string, string, string]>,
  fn: (ws: string) => void | Promise<void>,
): Promise<void> {
  const ws = await Deno.makeTempDir({ prefix: "journal-trace-scope-" });
  try {
    await Deno.mkdir(join(ws, ".exa"), { recursive: true });
    const db = new Database(join(ws, ".exa", "journal.db"));
    db.prepare(
      "CREATE TABLE activity (rowid INTEGER PRIMARY KEY, trace_id TEXT, action_type TEXT, payload TEXT)",
    ).run();
    for (const [traceId, actionType, payload] of rows) {
      db.prepare("INSERT INTO activity (trace_id, action_type, payload) VALUES (?, ?, ?)")
        .run(traceId, actionType, payload);
    }
    db.close();
    // The criterion loads event rows from a journal_file (the CLI path needs a live daemon);
    // resolveCurrentTrace reads the sqlite journal for the current request's trace.
    await Deno.writeTextFile(
      join(ws, JOURNAL_FILE),
      rows
        .filter(([_traceId, actionType]) => actionType !== EVENT_REQUEST_CREATED)
        .map(([traceId, actionType, payload]) => {
          const line: Record<string, string> = { trace_id: traceId, action_type: actionType, payload };
          return JSON.stringify(line);
        })
        .join("\n") + "\n",
    );
    await fn(ws);
  } finally {
    await Deno.remove(ws, { recursive: true });
  }
}

function makeScopedCriterion(
  equals: Record<string, string>,
  traceScope?: "current",
): {
  id: string;
  kind: CriterionKind;
  event_type: string;
  journal_file: string;
  payload_equals: Record<string, string>;
  trace_scope?: "current";
} {
  return {
    id: "effort-trace",
    kind: CriterionKind.JOURNAL_EVENT_EXISTS,
    event_type: EVENT_EFFORT_RESOLVED,
    journal_file: JOURNAL_FILE,
    payload_equals: equals,
    ...(traceScope !== undefined ? { trace_scope: traceScope } : {}),
  };
}

Deno.test("[journal_trace_scope] without the flag a globally found event from another trace satisfies the assertion", async () => {
  await withJournal(ROWS, async (ws) => {
    const result = await evaluateCriterion({
      workspaceRoot: ws,
      phase: CriterionPhase.OUTPUT,
      criterion: makeScopedCriterion({ [PAYLOAD_KEY_EFFORT_BASIS]: BASIS_HEURISTIC }) as never,
      traceBaselineRowid: 0,
    });
    assertEquals(result.status, CriterionStatus.PASSED, "a global match sees the other trace's event");
  });
});

Deno.test("[journal_trace_scope] trace_scope current ignores an identical event from another trace", async () => {
  await withJournal(ROWS, async (ws) => {
    const result = await evaluateCriterion({
      workspaceRoot: ws,
      phase: CriterionPhase.OUTPUT,
      criterion: makeScopedCriterion({ [PAYLOAD_KEY_EFFORT_BASIS]: BASIS_HEURISTIC }, "current") as never,
      traceBaselineRowid: 0,
    });
    assertEquals(
      result.status,
      CriterionStatus.FAILED,
      "the other trace's identical event must be excluded by trace_scope current",
    );
  });
});

Deno.test("[journal_trace_scope] trace_scope current passes on the current request's own event", async () => {
  await withJournal(ROWS, async (ws) => {
    const result = await evaluateCriterion({
      workspaceRoot: ws,
      phase: CriterionPhase.OUTPUT,
      criterion: makeScopedCriterion({ [PAYLOAD_KEY_EFFORT_BASIS]: BASIS_NATIVE_ADAPTIVE }, "current") as never,
      traceBaselineRowid: 0,
    });
    assertEquals(result.status, CriterionStatus.PASSED, "the current request's own event must match");
  });
});
