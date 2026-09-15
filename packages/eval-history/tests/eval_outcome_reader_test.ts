/**
 * @module EvalOutcomeReaderTest
 * @path packages/eval-history/tests/eval_outcome_reader_test.ts
 * @description Verifies narrow deterministic OTel eval-outcome lookup contracts.
 * @architectural-layer Test
 * @dependencies [@std/assert, @exaix/eval-history]
 * @related-files [packages/eval-history/src/history_sqlite.ts]
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { EvalScoringMode } from "@exaix/core";
import { EvalSqliteStore, type IEvalHistoryEntry, type IEvalOutcomeReader } from "@exaix/eval-history";

function entry(runId: string, traceId?: string, cellId?: string): IEvalHistoryEntry {
  return {
    run_id: runId,
    scenario_id: `scenario-${runId}`,
    outcome: "success",
    mode: "auto",
    scoring_mode: EvalScoringMode.ADDITIVE,
    suite_score: runId === "run-b" ? 0.5 : 0.9,
    passed: runId !== "run-b",
    timestamp: runId === "run-b" ? "2026-09-15T10:00:01Z" : "2026-09-15T10:00:00Z",
    component_versions: { binary_version: "1", schema_version: "1" },
    trace_id: traceId,
    cell_id: cellId,
  };
}

function withReader(test: (reader: IEvalOutcomeReader, store: EvalSqliteStore) => void): void {
  const dir = Deno.makeTempDirSync({ prefix: "phase-177-eval-reader-" });
  const store = new EvalSqliteStore(join(dir, "eval.db"));
  try {
    test(store, store);
  } finally {
    store.close();
    Deno.removeSync(dir, { recursive: true });
  }
}

Deno.test("eval outcome reader returns zero or one narrow result by run ID", () => {
  withReader((reader, store) => {
    store.writeRun(entry("run-a", "trace-a", "cell-a"));
    assertEquals(reader.getByRunId("missing"), undefined);
    assertEquals(reader.getByRunId("run-a"), {
      run_id: "run-a",
      trace_id: "trace-a",
      suite_score: 0.9,
      passed: true,
      cell_id: "cell-a",
    });
  });
});

Deno.test("eval outcome reader lists trace matches in deterministic run-ID order", () => {
  withReader((reader, store) => {
    store.writeRun(entry("run-b", "trace-shared"));
    store.writeRun(entry("run-a", "trace-shared", "cell-a"));
    store.writeRun(entry("run-c"));
    assertEquals(reader.listByTraceId("missing"), []);
    assertEquals(reader.listByTraceId("trace-shared"), [
      { run_id: "run-a", trace_id: "trace-shared", suite_score: 0.9, passed: true, cell_id: "cell-a" },
      { run_id: "run-b", trace_id: "trace-shared", suite_score: 0.5, passed: false, cell_id: null },
    ]);
  });
});
