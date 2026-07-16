/**
 * @module CriteriaResultsPersistenceTest
 * @path packages/eval-history/tests/criteria_results_persistence_test.ts
 * @description Tests that criterion results (incl. judge provenance, fractional scores)
 * round-trip through eval_criteria_results via writeRun.
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { Database } from "@db/sqlite";
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

Deno.test("[CriteriaResults] criterion results with score and status persist through writeRun", () => {
  withStore((store) => {
    store.initialize();
    const entry = makeTestEntry({ run_id: "cr-test-1" });
    store.writeRun(entry, [
      {
        stepId: "step-1",
        stepType: "shell",
        score: 0.85,
        executionStatus: "completed",
        criterionResults: [
          { criterion_id: "c1", kind: "llm-judge", status: "passed", score: 0.85, score_weight: 1.0 },
          { criterion_id: "c2", kind: "command-exit-code", status: "passed", score: 1.0, score_weight: 0.5 },
          { criterion_id: "c3", kind: "file-found", status: "failed", score: 0.0, score_weight: 1.0 },
        ],
      },
    ]);

    const rows = (store["db"] as Database).prepare(
      "SELECT criterion_id, kind, score, status, score_weight FROM eval_criteria_results WHERE run_id = ? ORDER BY criterion_id",
    ).all<
      { criterion_id: string; kind: string; score: number | null; status: string | null; score_weight: number | null }
    >(
      "cr-test-1",
    );

    assertEquals(rows.length, 3);
    assertEquals(rows[0].criterion_id, "c1");
    assertEquals(rows[0].kind, "llm-judge");
    assertEquals(rows[0].score, 0.85);
    assertEquals(rows[0].status, "passed");
    assertEquals(rows[1].criterion_id, "c2");
    assertEquals(rows[1].score, 1.0);
    assertEquals(rows[2].criterion_id, "c3");
    assertEquals(rows[2].score, 0.0);
    assertEquals(rows[2].status, "failed");
  });
});

Deno.test("[CriteriaResults] judge provenance JSON is stored and retrievable", () => {
  withStore((store) => {
    store.initialize();
    const entry = makeTestEntry({ run_id: "cr-judge-1" });
    const judgeProvenance = { provider: "openai", model: "gpt-4", reasoning: "Good code quality" };
    store.writeRun(entry, [
      {
        stepId: "step-1",
        score: 0.9,
        criterionResults: [
          { criterion_id: "judge-1", kind: "llm-judge", status: "passed", score: 0.9, judge: judgeProvenance },
        ],
      },
    ]);

    const row = (store["db"] as Database).prepare(
      "SELECT judge FROM eval_criteria_results WHERE run_id = ?",
    ).get<{ judge: string }>("cr-judge-1");

    const parsed = JSON.parse(row!.judge);
    assertEquals(parsed.provider, "openai");
    assertEquals(parsed.model, "gpt-4");
    assertEquals(parsed.reasoning, "Good code quality");
  });
});

Deno.test("[CriteriaResults] v2 database migrates to v3 additively with old data intact", () => {
  const dbDir = Deno.makeTempDirSync({ prefix: "scenario-framework-sqlite-migrate-" });
  const dbPath = join(dbDir, "eval.db");
  const legacyDb = new Database(dbPath);

  // Create v2 schema (eval_criteria_results without score/status/judge)
  legacyDb.exec(`CREATE TABLE IF NOT EXISTS eval_schema_version (
    version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')), description TEXT NOT NULL
  )`);
  legacyDb.exec(`INSERT INTO eval_schema_version (version, description) VALUES (1, 'v1'), (2, 'v2')`);
  legacyDb.exec(`CREATE TABLE IF NOT EXISTS eval_runs (
    run_id TEXT PRIMARY KEY, run_timestamp TEXT NOT NULL, scenario_id TEXT NOT NULL,
    pack TEXT NOT NULL DEFAULT '', suite_score REAL NOT NULL, passed INTEGER NOT NULL,
    mode TEXT NOT NULL DEFAULT 'auto'
  )`);
  legacyDb.exec(`INSERT INTO eval_runs (run_id, run_timestamp, scenario_id, pack, suite_score, passed, mode)
    VALUES ('migrate-run', '2026-06-01T00:00:00Z', 'old-scenario', 'smoke', 0.75, 1, 'auto')`);
  legacyDb.exec(`CREATE TABLE IF NOT EXISTS eval_criteria_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL, step_index INTEGER NOT NULL,
    criterion_id TEXT NOT NULL, kind TEXT NOT NULL, passed INTEGER NOT NULL, score_weight REAL DEFAULT 1.0, message TEXT
  )`);
  legacyDb.exec(
    `INSERT INTO eval_criteria_results (run_id, step_index, criterion_id, kind, passed, score_weight, message)
    VALUES ('migrate-run', 0, 'old-criterion', 'file-exists', 1, 1.0, 'old message')`,
  );
  legacyDb.close();

  // Re-open via store and upgrade
  const upgradedStore = new EvalSqliteStore(dbPath);
  try {
    upgradedStore.initialize();

    // Old data survived
    const runs = upgradedStore.queryRuns({});
    assertEquals(runs.length, 1);
    assertEquals(runs[0].suite_score, 0.75);

    const oldRows = (upgradedStore["db"] as Database).prepare(
      "SELECT criterion_id, message FROM eval_criteria_results WHERE run_id = ?",
    ).all<{ criterion_id: string; message: string }>("migrate-run");
    assertEquals(oldRows.length, 1);
    assertEquals(oldRows[0].criterion_id, "old-criterion");
    assertEquals(oldRows[0].message, "old message");

    // v3 version recorded
    const versions = (upgradedStore["db"] as Database).prepare(
      "SELECT version FROM eval_schema_version ORDER BY version",
    ).all<{ version: number }>();
    assertEquals(versions.length, 3);
    assertEquals(versions[2].version, 3);
  } finally {
    upgradedStore.close();
    try {
      Deno.removeSync(dbDir, { recursive: true });
    } catch { /* ok */ }
  }
});
