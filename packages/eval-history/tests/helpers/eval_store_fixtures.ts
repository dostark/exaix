/**
 * @module EvalStoreTestFixtures
 * @path packages/eval-history/tests/helpers/eval_store_fixtures.ts
 * @description A history entry builder and a temporary SQLite store wrapper shared by the eval-history tests.
 * @architectural-layer Test
 * @related-files [packages/eval-history/tests/history_sqlite_test.ts, packages/eval-history/tests/criteria_results_persistence_test.ts]
 */

import { EvalScoringMode } from "@exaix/core";
import { join } from "@std/path";
import { EvalSqliteStore, type IEvalHistoryEntry } from "@exaix/eval-history";

export function makeTestEntry(overrides: Partial<IEvalHistoryEntry> = {}): IEvalHistoryEntry {
  return {
    run_id: crypto.randomUUID(),
    scenario_id: "test-scenario",
    pack: "smoke",
    outcome: "success",
    mode: "auto",
    scoring_mode: EvalScoringMode.ADDITIVE,
    suite_score: 0.95,
    passed: true,
    timestamp: new Date().toISOString(),
    component_versions: { binary_version: "1.0.3", schema_version: "1.5.0" },
    ...overrides,
  };
}

export function withStore(fn: (store: EvalSqliteStore, dbPath: string) => void): void {
  const dbPath = join(Deno.makeTempDirSync({ prefix: "scenario-framework-sqlite-" }), "eval.db");
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
