/**
 * @module ScenarioFrameworkHistorySqlite
 * @path tests/scenario_framework/runner/history_sqlite.ts
 * @description SQLite-backed evaluation history store with table creation
 * migration, write, query, compare, and cleanup operations.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/schema/history_schema.ts, tests/scenario_framework/runner/history_writer.ts]
 */

import { Database } from "@db/sqlite";
import { dirname, resolve } from "@std/path";
import type { IEvalHistoryEntry } from "../schema/history_schema.ts";

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
}

interface IStepRow {
  run_id: string;
  step_index: number;
  step_id: string;
  step_type: string | null;
  score: number;
  execution_status: string | null;
}

export class EvalSqliteStore {
  private db: Database;
  private dbPath: string;
  private initialized = false;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
    this.db = new Database(dbPath);
    this.db.exec("PRAGMA journal_mode=WAL");
  }

  initialize(): void {
    if (this.initialized) return;

    Deno.mkdirSync(dirname(resolve(this.dbPath)), { recursive: true });

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
        pack TEXT NOT NULL,
        tags TEXT,
        suite_score REAL NOT NULL,
        passed INTEGER NOT NULL,
        mode TEXT NOT NULL DEFAULT 'auto',
        score_threshold REAL,
        trials INTEGER DEFAULT 1,
        exactl_version TEXT,
        schema_version TEXT,
        metadata TEXT
      )
    `);

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_runs_scenario ON eval_runs(scenario_id)
    `);
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_runs_pack ON eval_runs(pack)
    `);
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_runs_timestamp ON eval_runs(run_timestamp)
    `);

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
        message TEXT
      )
    `);

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_criteria_run ON eval_criteria_results(run_id, step_index)
    `);

    // Insert schema version if not exists
    const existingVersion = this.db.prepare(
      "SELECT version FROM eval_schema_version WHERE version = 1",
    ).get<{ version: number }>();

    if (!existingVersion) {
      this.db.exec(
        "INSERT INTO eval_schema_version (version, description) VALUES (1, 'Initial eval history schema: runs, steps, criteria')",
      );
    }

    this.initialized = true;
  }

  writeRun(
    entry: IEvalHistoryEntry,
    steps?: Array<{ stepId: string; stepType?: string; score: number; executionStatus?: string }>,
  ): void {
    if (!this.initialized) {
      this.initialize();
    }

    const insertRun = this.db.prepare(
      `INSERT OR REPLACE INTO eval_runs
        (run_id, run_timestamp, scenario_id, pack, suite_score, passed, mode, trials, exactl_version, schema_version, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    const insertStep = this.db.prepare(
      `INSERT OR REPLACE INTO eval_run_steps
        (run_id, step_index, step_id, step_type, score, execution_status)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );

    const transaction = this.db.transaction(() => {
      insertRun.run(
        entry.run_id,
        entry.timestamp,
        entry.scenario_id,
        "",
        entry.suite_score ?? 0,
        entry.passed ? 1 : 0,
        entry.mode,
        1,
        entry.component_versions?.binary_version ?? null,
        entry.component_versions?.schema_version ?? null,
        null,
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
          );
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
