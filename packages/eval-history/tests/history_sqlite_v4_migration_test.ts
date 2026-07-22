/**
 * @module EvalHistorySqliteV4MigrationTest
 * @path packages/eval-history/tests/history_sqlite_v4_migration_test.ts
 * @description Phase 140a Step 4 — RED-first test. The v4 migration block (opened in Step 1
 * for eval_run_steps.duration_ms) must also add the remaining timing/token/tracked-cost columns
 * to both eval_run_steps and eval_runs. A fixture v3 SQLite DB (no v4 columns) must migrate
 * cleanly on initialize() with old rows reading back NULL in every new column.
 * @architectural-layer Test
 * @related-files [packages/eval-history/src/history_sqlite.ts]
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { Database } from "@db/sqlite";
import { EvalSqliteStore } from "@exaix/eval-history";

const NEW_RUN_STEP_COLUMNS = [
  "llm_duration_ms",
  "tokens_prompt",
  "tokens_completion",
  "tokens_cache_read",
  "tokens_cache_creation",
  "tracked_cost_usd",
];

const NEW_RUN_COLUMNS = [
  "total_llm_duration_ms",
  "total_tokens_prompt",
  "total_tokens_completion",
  "total_tokens_cache_read",
  "total_tokens_cache_creation",
  "total_tracked_cost_usd",
];

interface INewRunStepColumnsRow {
  llm_duration_ms: number | null;
  tokens_prompt: number | null;
  tokens_completion: number | null;
  tokens_cache_read: number | null;
  tokens_cache_creation: number | null;
  tracked_cost_usd: number | null;
}

interface INewRunColumnsRow {
  total_llm_duration_ms: number | null;
  total_tokens_prompt: number | null;
  total_tokens_completion: number | null;
  total_tokens_cache_read: number | null;
  total_tokens_cache_creation: number | null;
  total_tracked_cost_usd: number | null;
}

Deno.test("[EvalHistorySqliteV4Migration] eval_run_steps and eval_runs gain the full v4 column set", () => {
  const dbPath = join(Deno.makeTempDirSync({ prefix: "eval-sqlite-v4-migration-" }), "eval.db");
  const store = new EvalSqliteStore(dbPath);
  try {
    store.initialize();

    const db = store["db"];
    const stepColumns = db.prepare("PRAGMA table_info(eval_run_steps)").all<{ name: string }>().map((c) => c.name);
    const runColumns = db.prepare("PRAGMA table_info(eval_runs)").all<{ name: string }>().map((c) => c.name);

    for (const col of NEW_RUN_STEP_COLUMNS) {
      assertEquals(stepColumns.includes(col), true, `eval_run_steps missing column ${col}`);
    }
    for (const col of NEW_RUN_COLUMNS) {
      assertEquals(runColumns.includes(col), true, `eval_runs missing column ${col}`);
    }
  } finally {
    store.close();
  }
});

Deno.test("[EvalHistorySqliteV4Migration] a fixture v3 DB (no v4 columns) migrates cleanly; old rows read back NULL in new columns", () => {
  const dir = Deno.makeTempDirSync({ prefix: "eval-sqlite-v4-fixture-" });
  const dbPath = join(dir, "eval.db");

  // Build a v3-shaped DB directly (bypassing EvalSqliteStore, which always creates latest schema).
  const rawDb = new Database(dbPath);
  rawDb.exec(`
    CREATE TABLE eval_schema_version (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now')),
      description TEXT NOT NULL
    )
  `);
  rawDb.exec(`
    CREATE TABLE eval_runs (
      run_id TEXT PRIMARY KEY,
      run_timestamp TEXT NOT NULL,
      scenario_id TEXT NOT NULL,
      pack TEXT NOT NULL DEFAULT '',
      suite_score REAL NOT NULL,
      passed INTEGER NOT NULL,
      mode TEXT NOT NULL DEFAULT 'auto',
      duration_ms INTEGER,
      trace_id TEXT,
      provider TEXT,
      model TEXT,
      cell_id TEXT
    )
  `);
  rawDb.exec(`
    CREATE TABLE eval_run_steps (
      run_id TEXT NOT NULL,
      step_index INTEGER NOT NULL,
      step_id TEXT NOT NULL,
      step_type TEXT,
      score REAL NOT NULL,
      execution_status TEXT,
      PRIMARY KEY (run_id, step_index)
    )
  `);
  rawDb.exec(`
    CREATE TABLE eval_criteria_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL,
      step_index INTEGER NOT NULL,
      criterion_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      passed INTEGER NOT NULL
    )
  `);
  rawDb.exec(
    "INSERT INTO eval_schema_version (version, description) VALUES (1, 'v1'), (2, 'v2'), (3, 'v3')",
  );
  rawDb.exec(
    "INSERT INTO eval_runs (run_id, run_timestamp, scenario_id, suite_score, passed, mode) VALUES ('pre-v4-run', '2026-01-01T00:00:00Z', 'legacy-scenario', 0.9, 1, 'auto')",
  );
  rawDb.exec(
    "INSERT INTO eval_run_steps (run_id, step_index, step_id, score) VALUES ('pre-v4-run', 0, 'legacy-step', 1.0)",
  );
  rawDb.close();

  const store = new EvalSqliteStore(dbPath);
  try {
    store.initialize();

    const db = store["db"];
    const runRow = db.prepare(
      `SELECT ${NEW_RUN_COLUMNS.join(", ")} FROM eval_runs WHERE run_id = 'pre-v4-run'`,
    ).get<INewRunColumnsRow>();
    const stepRow = db.prepare(
      `SELECT ${NEW_RUN_STEP_COLUMNS.join(", ")} FROM eval_run_steps WHERE run_id = 'pre-v4-run'`,
    ).get<INewRunStepColumnsRow>();

    assertEquals(runRow?.total_llm_duration_ms, null);
    assertEquals(runRow?.total_tokens_prompt, null);
    assertEquals(runRow?.total_tokens_completion, null);
    assertEquals(runRow?.total_tokens_cache_read, null);
    assertEquals(runRow?.total_tokens_cache_creation, null);
    assertEquals(runRow?.total_tracked_cost_usd, null);

    assertEquals(stepRow?.llm_duration_ms, null);
    assertEquals(stepRow?.tokens_prompt, null);
    assertEquals(stepRow?.tokens_completion, null);
    assertEquals(stepRow?.tokens_cache_read, null);
    assertEquals(stepRow?.tokens_cache_creation, null);
    assertEquals(stepRow?.tracked_cost_usd, null);
  } finally {
    store.close();
  }
});
