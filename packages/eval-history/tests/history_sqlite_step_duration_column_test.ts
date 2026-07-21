/**
 * @module EvalHistorySqliteStepDurationColumnTest
 * @path packages/eval-history/tests/history_sqlite_step_duration_column_test.ts
 * @description Phase 140a Step 1 — RED-first test. EvalSqliteStore.writeRun's steps parameter
 * has no durationMs field and eval_run_steps has no duration_ms column, so a manifest step's
 * wall-clock duration (Phase 140a Step 1) never reaches SQLite even after history_writer.ts
 * carries it into the JSONL-bound entry. Verifies the v4 migration adds duration_ms to
 * eval_run_steps and that writeRun persists a step's durationMs into that column (NULL when
 * absent, not 0).
 * @architectural-layer Test
 * @related-files [packages/eval-history/src/history_sqlite.ts]
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { EvalSqliteStore, type IEvalHistoryEntry } from "@exaix/eval-history";

function makeTestEntry(overrides: Partial<IEvalHistoryEntry> = {}): IEvalHistoryEntry {
  return {
    run_id: crypto.randomUUID(),
    scenario_id: "test-scenario",
    pack: "smoke",
    outcome: "success",
    mode: "auto",
    suite_score: 0.95,
    passed: true,
    timestamp: new Date().toISOString(),
    component_versions: { binary_version: "1.0.3", schema_version: "1.5.0" },
    ...overrides,
  };
}

function withStore(fn: (store: EvalSqliteStore, dbPath: string) => void): void {
  const dbPath = join(Deno.makeTempDirSync({ prefix: "scenario-framework-sqlite-step-duration-" }), "eval.db");
  const store = new EvalSqliteStore(dbPath);
  try {
    fn(store, dbPath);
  } finally {
    store.close();
    try {
      Deno.removeSync(dbPath);
    } catch { /* ok */ }
  }
}

Deno.test("[EvalHistorySqliteStepDuration] eval_run_steps gains a duration_ms column via the v4 migration", () => {
  withStore((store) => {
    store.initialize();

    const columns = store["db"].prepare("PRAGMA table_info(eval_run_steps)").all<{ name: string }>();
    const columnNames = columns.map((c) => c.name);
    assertEquals(columnNames.includes("duration_ms"), true);
  });
});

Deno.test("[EvalHistorySqliteStepDuration] writeRun persists a step's durationMs into eval_run_steps.duration_ms", () => {
  withStore((store) => {
    store.initialize();
    const entry = makeTestEntry({ run_id: "run-with-duration" });

    store.writeRun(entry, [
      { stepId: "step-1", stepType: "shell", score: 1.0, executionStatus: "passed", durationMs: 777 },
    ]);

    const row = store["db"].prepare(
      "SELECT duration_ms FROM eval_run_steps WHERE run_id = ?",
    ).get<{ duration_ms: number | null }>("run-with-duration");

    assertEquals(row?.duration_ms, 777);
  });
});

Deno.test("[EvalHistorySqliteStepDuration] a step with no durationMs persists NULL, not 0", () => {
  withStore((store) => {
    store.initialize();
    const entry = makeTestEntry({ run_id: "run-without-duration" });

    store.writeRun(entry, [
      { stepId: "step-1", stepType: "shell", score: 1.0, executionStatus: "passed" },
    ]);

    const row = store["db"].prepare(
      "SELECT duration_ms FROM eval_run_steps WHERE run_id = ?",
    ).get<{ duration_ms: number | null }>("run-without-duration");

    assertEquals(row?.duration_ms, null);
  });
});
