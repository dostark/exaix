/**
 * @module EvalHistorySqlite
 * @path packages/eval-history/src/history_sqlite.ts
 * @description SQLite-backed evaluation history store with table creation
 * migration, write, query, compare, and cleanup operations. Consumed by the
 * `exactl eval` command (production) and the scenario-framework runner.
 * @architectural-layer Services
 * @dependencies [@db/sqlite, @std/path]
 * @related-files [packages/eval-history/src/history_schema.ts, packages/eval-history/mod.ts]
 */

import { Database } from "@db/sqlite";
import { dirname, resolve } from "@std/path";
import type { Opt, Reason } from "@exaix/core/types";
import type { IEvalHistoryEntry } from "./history_schema.ts";

interface IRunRow {
  run_id: string;
  run_timestamp: string;
  scenario_id: string;
  pack: string;
  suite_score: number;
  passed: number;
  mode: string;
  score_threshold: number | null;
  trials: number;
  exactl_version: string | null;
  schema_version: string | null;
  duration_ms: number | null;
  trace_id: string | null;
  provider: string | null;
  model: string | null;
  cell_id: string | null;
  /** Scenario-level aggregates, Phase 140a Step 4. */
  total_llm_duration_ms: number | null;
  total_tokens_prompt: number | null;
  total_tokens_completion: number | null;
  total_tokens_cache_read: number | null;
  total_tokens_cache_creation: number | null;
  total_tracked_cost_usd: number | null;
}

interface IStepRow {
  run_id: string;
  step_index: number;
  step_id: string;
  step_type: string | null;
  score: number;
  execution_status: string | null;
}

interface ICriterionResultRow {
  criterion_id: string;
  kind: string;
  status: string;
  score?: number | null;
  score_weight?: number | null;
  judge?: { provider?: string; model?: string; reasoning?: string } | null;
}

/**
 * Resolve the evaluation database path.
 * Precedence: EXA_EVAL_DB_PATH env var > <workspaceRoot>/.exa/eval.db
 */
export function resolveEvalDbPath(workspaceRoot?: Opt<string, Reason.OptionalInput>): string {
  const envPath = Deno.env.get("EXA_EVAL_DB_PATH");
  if (envPath) return envPath;
  const root = workspaceRoot ?? Deno.cwd();
  return resolve(root, ".exa", "eval.db");
}

const SQLITE_DUP_COLUMN_ERR = "duplicate column name";

export class EvalSqliteStore {
  private db: Database;
  private dbPath: string;
  private initialized = false;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
    Deno.mkdirSync(dirname(resolve(this.dbPath)), { recursive: true });
    this.db = new Database(dbPath);
    this.db.exec("PRAGMA journal_mode=WAL");
  }

  initialize(): void {
    if (this.initialized) return;

    // Always create all tables and indexes with latest schema (IF NOT EXISTS for idempotency)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS eval_schema_version (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL DEFAULT (datetime('now')),
        description TEXT NOT NULL
      )
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS eval_runs (
        run_id TEXT PRIMARY KEY,
        run_timestamp TEXT NOT NULL,
        scenario_id TEXT NOT NULL,
        pack TEXT NOT NULL DEFAULT '',
        tags TEXT,
        suite_score REAL NOT NULL,
        passed INTEGER NOT NULL,
        mode TEXT NOT NULL DEFAULT 'auto',
        score_threshold REAL,
        step_count INTEGER,
        trials INTEGER DEFAULT 1,
        suite_score_mean REAL,
        suite_score_stdev REAL,
        pass_at_1 REAL,
        pass_pow_k REAL,
        pass_k INTEGER,
        blueprint_id TEXT,
        blueprint_version TEXT,
        exactl_version TEXT,
        schema_version TEXT,
        trial_scores TEXT,
        metadata TEXT
      )
    `);

    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_runs_scenario ON eval_runs(scenario_id)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_runs_pack ON eval_runs(pack)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_runs_timestamp ON eval_runs(run_timestamp)`);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS eval_run_steps (
        run_id TEXT NOT NULL REFERENCES eval_runs(run_id),
        step_index INTEGER NOT NULL,
        step_id TEXT NOT NULL,
        step_type TEXT,
        score REAL NOT NULL,
        criteria_passed INTEGER,
        criteria_total INTEGER,
        execution_status TEXT,
        PRIMARY KEY (run_id, step_index)
      )
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS eval_criteria_results (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id TEXT NOT NULL REFERENCES eval_runs(run_id),
        step_index INTEGER NOT NULL,
        criterion_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        passed INTEGER NOT NULL,
        score_weight REAL DEFAULT 1.0,
        message TEXT,
        score REAL,
        status TEXT,
        judge TEXT
      )
    `);

    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_criteria_run ON eval_criteria_results(run_id, step_index)`);

    this.applyMigrations();
    this.initialized = true;
  }

  private addColumns(table: string, columns: string[]): void {
    for (const colDef of columns) {
      try {
        this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${colDef}`);
      } catch (error) {
        const msg = (error as Error).message;
        if (msg.includes(SQLITE_DUP_COLUMN_ERR)) continue;
        throw error;
      }
    }
  }

  private applyMigrations(): void {
    const currentVersion = this.db.prepare(
      "SELECT COALESCE(MAX(version), 0) as v FROM eval_schema_version",
    ).get<{ v: number }>()?.v ?? 0;

    if (currentVersion < 2) {
      this.addColumns("eval_runs", [
        "step_count INTEGER",
        "suite_score_mean REAL",
        "suite_score_stdev REAL",
        "pass_at_1 REAL",
        "pass_pow_k REAL",
        "pass_k INTEGER",
        "blueprint_id TEXT",
        "blueprint_version TEXT",
        "trial_scores TEXT",
        "score_threshold REAL",
        "trials INTEGER DEFAULT 1",
        "exactl_version TEXT",
        "schema_version TEXT",
        "metadata TEXT",
      ]);
      this.addColumns("eval_run_steps", [
        "step_type TEXT",
        "criteria_passed INTEGER",
        "criteria_total INTEGER",
        "execution_status TEXT",
      ]);
      this.db.exec(
        "INSERT OR IGNORE INTO eval_schema_version (version, description) VALUES " +
          "(1, 'Initial eval history schema: runs, steps, criteria'), " +
          "(2, 'Add step_count, multi-trial metrics, blueprint fields to eval_runs')",
      );
    }

    if (currentVersion < 3) {
      this.addColumns("eval_criteria_results", ["score REAL", "status TEXT", "judge TEXT"]);
      this.addColumns("eval_runs", [
        "duration_ms INTEGER",
        "trace_id TEXT",
        "provider TEXT",
        "model TEXT",
        "cell_id TEXT",
      ]);
      this.db.exec(
        "INSERT OR IGNORE INTO eval_schema_version (version, description) VALUES " +
          "(3, 'Add score/status/judge to eval_criteria_results, duration_ms/trace_id/provider/model/cell_id to eval_runs')",
      );
    }

    if (currentVersion < 4) {
      this.addColumns("eval_run_steps", [
        "duration_ms INTEGER",
        "llm_duration_ms INTEGER",
        "tokens_prompt INTEGER",
        "tokens_completion INTEGER",
        "tokens_cache_read INTEGER",
        "tokens_cache_creation INTEGER",
        "tracked_cost_usd REAL",
      ]);
      this.addColumns("eval_runs", [
        "total_llm_duration_ms INTEGER",
        "total_tokens_prompt INTEGER",
        "total_tokens_completion INTEGER",
        "total_tokens_cache_read INTEGER",
        "total_tokens_cache_creation INTEGER",
        "total_tracked_cost_usd REAL",
      ]);
      this.db.exec(
        "INSERT OR IGNORE INTO eval_schema_version (version, description) VALUES " +
          "(4, 'Add duration_ms to eval_run_steps (Phase 140a Step 1); add llm_duration_ms/tokens/tracked_cost_usd to eval_run_steps and eval_runs (Phase 140a Step 4)')",
      );
    }
  }

  writeRun(
    entry: IEvalHistoryEntry,
    steps?: Opt<
      Array<{
        stepId: string;
        stepType?: string;
        score: number;
        executionStatus?: string;
        criterionResults?: ICriterionResultRow[];
        /** Runner-observed wall-clock duration for this step, ms. Phase 140a Step 1. */
        durationMs?: number;
        /** LLM-call wall-clock duration summed from journal payloads, ms. Phase 140a Step 4. */
        llmDurationMs?: number;
        tokens?: { prompt: number; completion: number; cacheRead?: number; cacheCreation?: number; total: number };
        /** Real tracked cost only — never a calculateCost() prediction. Phase 140a Step 4. */
        trackedCostUsd?: number;
      }>,
      Reason.OptionalInput
    >,
  ): void {
    if (!this.initialized) {
      this.initialize();
    }

    const insertRun = this.db.prepare(
      `INSERT OR REPLACE INTO eval_runs
        (run_id, run_timestamp, scenario_id, pack, suite_score, passed, mode, score_threshold,
         step_count, trials, suite_score_mean, suite_score_stdev, pass_at_1, pass_pow_k, pass_k,
         blueprint_id, blueprint_version, exactl_version, schema_version, trial_scores, metadata,
         duration_ms, trace_id, provider, model, cell_id,
         total_llm_duration_ms, total_tokens_prompt, total_tokens_completion,
         total_tokens_cache_read, total_tokens_cache_creation, total_tracked_cost_usd)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    const insertStep = this.db.prepare(
      `INSERT OR REPLACE INTO eval_run_steps
        (run_id, step_index, step_id, step_type, score, execution_status, duration_ms,
         llm_duration_ms, tokens_prompt, tokens_completion, tokens_cache_read,
         tokens_cache_creation, tracked_cost_usd)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    const insertCriterion = this.db.prepare(
      `INSERT INTO eval_criteria_results
        (run_id, step_index, criterion_id, kind, passed, score_weight, message, score, status, judge)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    const transaction = this.db.transaction(() => {
      insertRun.run(
        entry.run_id,
        entry.timestamp,
        entry.scenario_id,
        entry.pack ?? "",
        entry.suite_score ?? 0,
        entry.passed ? 1 : 0,
        entry.mode,
        entry.score_threshold ?? null,
        entry.step_count ?? null,
        entry.trials ?? 1,
        entry.suite_score_mean ?? null,
        entry.suite_score_stdev ?? null,
        entry.pass_at_1 ?? null,
        entry.pass_pow_k ?? null,
        entry.pass_k ?? null,
        entry.blueprint_id ?? null,
        entry.blueprint_version ?? null,
        entry.component_versions?.binary_version ?? null,
        entry.component_versions?.schema_version ?? null,
        entry.trial_scores ? JSON.stringify(entry.trial_scores) : null,
        null,
        entry.duration_ms ?? null,
        entry.trace_id ?? null,
        entry.provider ?? null,
        entry.model ?? null,
        entry.cell_id ?? null,
        entry.total_llm_duration_ms ?? null,
        entry.total_tokens_prompt ?? null,
        entry.total_tokens_completion ?? null,
        entry.total_tokens_cache_read ?? null,
        entry.total_tokens_cache_creation ?? null,
        entry.total_tracked_cost_usd ?? null,
      );

      if (steps) {
        for (let i = 0; i < steps.length; i++) {
          const step = steps[i];
          insertStep.run(
            entry.run_id,
            i,
            step.stepId,
            step.stepType ?? null,
            step.score,
            step.executionStatus ?? null,
            step.durationMs ?? null,
            step.llmDurationMs ?? null,
            step.tokens?.prompt ?? null,
            step.tokens?.completion ?? null,
            step.tokens?.cacheRead ?? null,
            step.tokens?.cacheCreation ?? null,
            step.trackedCostUsd ?? null,
          );
          if (step.criterionResults) {
            for (const cr of step.criterionResults) {
              insertCriterion.run(
                entry.run_id,
                i,
                cr.criterion_id,
                cr.kind,
                cr.status === "passed" ? 1 : 0,
                cr.score_weight ?? null,
                null,
                cr.score ?? null,
                cr.status,
                cr.judge ? JSON.stringify(cr.judge) : null,
              );
            }
          }
        }
      }
    });

    transaction();
  }

  queryRuns(options: {
    scenario?: string;
    pack?: string;
    last?: number;
    since?: string;
  }): IRunRow[] {
    const conditions: string[] = [];
    const params: (string | number)[] = [];

    if (options.scenario) {
      conditions.push("scenario_id = ?");
      params.push(options.scenario);
    }
    if (options.pack) {
      conditions.push("pack = ?");
      params.push(options.pack);
    }
    if (options.since) {
      conditions.push("run_timestamp >= ?");
      params.push(options.since);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const limit = options.last ? `LIMIT ${options.last}` : "";

    return this.db.prepare(
      `SELECT * FROM eval_runs ${where} ORDER BY run_timestamp DESC ${limit}`,
    ).all<IRunRow>(...params);
  }

  compareRuns(runIdA: string, runIdB: string): {
    runA: IRunRow | null;
    runB: IRunRow | null;
    scoreDelta: number;
    stepsA: IStepRow[];
    stepsB: IStepRow[];
  } {
    const runA = this.db.prepare("SELECT * FROM eval_runs WHERE run_id = ?").get<IRunRow>(runIdA) ?? null;
    const runB = this.db.prepare("SELECT * FROM eval_runs WHERE run_id = ?").get<IRunRow>(runIdB) ?? null;

    const scoreDelta = (runB?.suite_score ?? 0) - (runA?.suite_score ?? 0);

    const stepsA = this.db.prepare(
      "SELECT * FROM eval_run_steps WHERE run_id = ? ORDER BY step_index",
    ).all<IStepRow>(runIdA);

    const stepsB = this.db.prepare(
      "SELECT * FROM eval_run_steps WHERE run_id = ? ORDER BY step_index",
    ).all<IStepRow>(runIdB);

    return { runA, runB, scoreDelta, stepsA, stepsB };
  }

  cleanup(retain: number): number {
    const deleted = this.db.prepare(`
      DELETE FROM eval_runs WHERE rowid NOT IN (
        SELECT rowid FROM (
          SELECT rowid FROM eval_runs WHERE scenario_id = ? ORDER BY run_timestamp DESC LIMIT ?
        )
      )
    `);

    const scenarios = this.db.prepare(
      "SELECT DISTINCT scenario_id FROM eval_runs",
    ).all<{ scenario_id: string }>();

    let totalDeleted = 0;
    for (const scenario of scenarios) {
      // First, clean up orphaned step/criteria results
      this.db.prepare(
        `DELETE FROM eval_run_steps WHERE run_id IN (
          SELECT run_id FROM eval_runs WHERE scenario_id = ?
          ORDER BY run_timestamp DESC
          LIMIT -1 OFFSET ?
        )`,
      ).run(scenario.scenario_id, retain);

      this.db.prepare(
        `DELETE FROM eval_criteria_results WHERE run_id IN (
          SELECT run_id FROM eval_runs WHERE scenario_id = ?
          ORDER BY run_timestamp DESC
          LIMIT -1 OFFSET ?
        )`,
      ).run(scenario.scenario_id, retain);

      const result = deleted.run(scenario.scenario_id, retain);
      totalDeleted += result;
    }

    return totalDeleted;
  }

  close(): void {
    this.db.close();
  }
}
