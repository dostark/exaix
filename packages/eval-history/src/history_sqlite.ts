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
import { EvalScoringMode } from "@exaix/core";
import type { IEvalHistoryEntry } from "./history_schema.ts";

/** Per-family summary row returned by summarizeByTag. */
export interface IFamilySummaryRow {
  family: string;
  taskCount: number;
  /** Number of scenarios that passed, counted exactly. */
  passedCount: number;
  meanScore: number;
  /** Whether a mean carries information (true when some run scored strictly between 0 and 1). */
  graded: boolean;
  meanPassAt1: number;
  reconcileRate: number;
  meanDurationMs: number;
  delta: number | null;
}

/** A run with outcome-channel scores attached for harness-lift comparison. */
export interface IOutcomeRunRow {
  run_id: string;
  scenario_id: string;
  pack: string | null;
  tags: string[] | null;
  run_timestamp: string;
  provider: string | null;
  model: string | null;
  cell_id: string | null;
  outcome_scores: number[];
}

const EVAL_TABLE_RUNS = "eval_runs";
const EVAL_SCHEMA_VERSION_INSERT = "INSERT OR IGNORE INTO eval_schema_version (version, description) VALUES ";
const SQL_AND_SEPARATOR = " AND ";
/** Pack-filter predicate, shared by the four run-query methods (check:magic). */
const SQL_CONDITION_PACK = "pack = ?";

interface IRunRow {
  run_id: string;
  run_timestamp: string;
  scenario_id: string;
  pack: string;
  tags: string | null;
  suite_score: number;
  passed: number;
  mode: string;
  scoring_mode: string;
  failure_classes: string | null;
  score_threshold: number | null;
  trials: number;
  /** The multi-trial metric — a real DB column, previously unexposed on this type even
   *  though `SELECT *` always returned it. */
  pass_pow_k: number | null;
  exactl_version: string | null;
  schema_version: string | null;
  duration_ms: number | null;
  trace_id: string | null;
  provider: string | null;
  model: string | null;
  cell_id: string | null;
  total_llm_duration_ms: number | null;
  total_tokens_prompt: number | null;
  total_tokens_completion: number | null;
  total_tokens_cache_read: number | null;
  total_tokens_cache_creation: number | null;
  total_tracked_cost_usd: number | null;
  /** External-benchmark provenance; null on non-external runs. */
  benchmark: string | null;
  benchmark_version: string | null;
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

/** Resolve eval DB path from EXA_EVAL_DB_PATH or <workspaceRoot>/.exa/eval.db. */
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
      this.addColumns(EVAL_TABLE_RUNS, [
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
        EVAL_SCHEMA_VERSION_INSERT +
          "(1, 'Initial eval history schema: runs, steps, criteria'), " +
          "(2, 'Add step_count, multi-trial metrics, blueprint fields to eval_runs')",
      );
    }

    if (currentVersion < 3) {
      this.addColumns("eval_criteria_results", ["score REAL", "status TEXT", "judge TEXT"]);
      this.addColumns(EVAL_TABLE_RUNS, [
        "duration_ms INTEGER",
        "trace_id TEXT",
        "provider TEXT",
        "model TEXT",
        "cell_id TEXT",
      ]);
      this.db.exec(
        EVAL_SCHEMA_VERSION_INSERT +
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
      this.addColumns(EVAL_TABLE_RUNS, [
        "total_llm_duration_ms INTEGER",
        "total_tokens_prompt INTEGER",
        "total_tokens_completion INTEGER",
        "total_tokens_cache_read INTEGER",
        "total_tokens_cache_creation INTEGER",
        "total_tracked_cost_usd REAL",
      ]);
      this.db.exec(
        EVAL_SCHEMA_VERSION_INSERT +
          "(4, 'Add duration_ms to eval_run_steps (Phase 140a Step 1); add llm_duration_ms/tokens/tracked_cost_usd to eval_run_steps and eval_runs (Phase 140a Step 4)')",
      );
    }

    if (currentVersion < 5) {
      this.addColumns(EVAL_TABLE_RUNS, ["tags TEXT"]);
      this.db.exec(
        EVAL_SCHEMA_VERSION_INSERT +
          "(5, 'Add tags column to eval_runs for task-family taxonomy (Phase 141 Step 1)')",
      );
    }

    if (currentVersion < 6) {
      this.addColumns(EVAL_TABLE_RUNS, ["scoring_mode TEXT NOT NULL DEFAULT 'additive'"]);
      this.db.exec(
        EVAL_SCHEMA_VERSION_INSERT +
          "(6, 'Add scoring_mode column to eval_runs (Phase 143 Step 3)')",
      );
    }

    if (currentVersion < 7) {
      this.addColumns(EVAL_TABLE_RUNS, ["failure_classes TEXT"]);
      this.db.exec(
        EVAL_SCHEMA_VERSION_INSERT +
          "(7, 'Add failure_classes column to eval_runs (Phase 143 Step 5)')",
      );
    }

    if (currentVersion < 8) {
      this.addColumns(EVAL_TABLE_RUNS, ["benchmark TEXT", "benchmark_version TEXT"]);
      this.db.exec(
        EVAL_SCHEMA_VERSION_INSERT +
          "(8, 'Add benchmark/benchmark_version columns to eval_runs for external-benchmark provenance (Phase 144 Step 4)')",
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
        /** Runner-observed wall-clock duration for this step, ms. */
        durationMs?: number;
        /** LLM-call wall-clock duration summed from journal payloads, ms. */
        llmDurationMs?: number;
        tokens?: { prompt: number; completion: number; cacheRead?: number; cacheCreation?: number; total: number };
        /** Real tracked cost only — never a calculateCost() prediction. */
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
        (run_id, run_timestamp, scenario_id, pack, tags, suite_score, passed, mode, score_threshold,
         step_count, trials, suite_score_mean, suite_score_stdev, pass_at_1, pass_pow_k, pass_k,
         blueprint_id, blueprint_version, exactl_version, schema_version, trial_scores, metadata,
         duration_ms, trace_id, provider, model, cell_id,
         total_llm_duration_ms, total_tokens_prompt, total_tokens_completion,
         total_tokens_cache_read, total_tokens_cache_creation, total_tracked_cost_usd, scoring_mode,
         failure_classes, benchmark, benchmark_version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        entry.tags ? JSON.stringify(entry.tags) : null,
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
        entry.scoring_mode ?? EvalScoringMode.ADDITIVE,
        entry.failure_classes ? JSON.stringify(entry.failure_classes) : null,
        entry.benchmark ?? null,
        entry.benchmark_version ?? null,
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
      conditions.push(SQL_CONDITION_PACK);
      params.push(options.pack);
    }
    if (options.since) {
      conditions.push("run_timestamp >= ?");
      params.push(options.since);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(SQL_AND_SEPARATOR)}` : "";
    const limit = options.last ? `LIMIT ${options.last}` : "";

    return this.db.prepare(
      `SELECT * FROM eval_runs ${where} ORDER BY run_timestamp DESC ${limit}`,
    ).all<IRunRow>(...params);
  }

  /** Query external-benchmark runs carrying benchmark provenance. */
  queryExternalRuns(options: { pack?: string } = {}): IRunRow[] {
    const conditions = ["benchmark IS NOT NULL AND benchmark != ''"];
    const params: (string | number)[] = [];

    if (options.pack) {
      conditions.push(SQL_CONDITION_PACK);
      params.push(options.pack);
    }

    return this.db.prepare(
      `SELECT * FROM eval_runs WHERE ${conditions.join(SQL_AND_SEPARATOR)} ORDER BY run_timestamp DESC`,
    ).all<IRunRow>(...params);
  }

  /** Query runs with outcome-channel step scores attached for harness-lift comparison. */
  queryOutcomeRuns(options: {
    scenario?: string;
    pack?: string;
    outcomeStepIds: string[];
  }): IOutcomeRunRow[] {
    const conditions: string[] = [];
    const params: (string | number)[] = [];

    if (options.scenario) {
      conditions.push("scenario_id = ?");
      params.push(options.scenario);
    }
    if (options.pack) {
      conditions.push(SQL_CONDITION_PACK);
      params.push(options.pack);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(SQL_AND_SEPARATOR)}` : "";
    const runs = this.db.prepare(
      `SELECT * FROM eval_runs ${where} ORDER BY run_timestamp DESC`,
    ).all<IRunRow>(...params);

    const outcomeStepIds = options.outcomeStepIds;
    const stepsByRun = new Map<string, number[]>();
    if (outcomeStepIds.length > 0 && runs.length > 0) {
      const placeholders = outcomeStepIds.map(() => "?").join(", ");
      const stepRows = this.db.prepare(
        `SELECT run_id, score FROM eval_run_steps WHERE step_id IN (${placeholders}) ORDER BY run_id, step_index`,
      ).all<{ run_id: string; score: number }>(...outcomeStepIds);
      for (const row of stepRows) {
        const scores = stepsByRun.get(row.run_id);
        if (scores) scores.push(row.score);
        else stepsByRun.set(row.run_id, [row.score]);
      }
    }

    return runs.map((run) => ({
      run_id: run.run_id,
      scenario_id: run.scenario_id,
      pack: run.pack ?? null,
      tags: run.tags ? (JSON.parse(run.tags) as string[]) : null,
      run_timestamp: run.run_timestamp,
      provider: run.provider,
      model: run.model,
      cell_id: run.cell_id,
      outcome_scores: stepsByRun.get(run.run_id) ?? [],
    }));
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

  /** Groups runs by tag prefix (e.g. "task:" matches "task:feature", "task:bug-fix"). */
  summarizeByTag(
    tagPrefix: string,
    options: { pack?: string; cellId?: string; lastPerScenario?: boolean },
  ): IFamilySummaryRow[] {
    const conditions: string[] = [`tags LIKE '["%${tagPrefix}%'`];
    const params: (string | number)[] = [];

    if (options.pack) {
      conditions.push(SQL_CONDITION_PACK);
      params.push(options.pack);
    }
    if (options.cellId) {
      conditions.push("cell_id = ?");
      params.push(options.cellId);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(SQL_AND_SEPARATOR)}` : "";
    const rows = this.db.prepare(
      `SELECT run_id, scenario_id, tags, suite_score, passed, duration_ms FROM eval_runs ${where} ORDER BY run_timestamp DESC`,
    ).all<
      {
        run_id: string;
        scenario_id: string;
        tags: string | null;
        suite_score: number;
        passed: number;
        duration_ms: number | null;
      }
    >(...params);

    // Deduplicate: keep only latest per scenario if lastPerScenario is true
    const filtered = this.deduplicateRuns(rows, options.lastPerScenario ?? false);

    // Group by tag prefix match
    const groups = this.groupRunsByTag(filtered, tagPrefix);

    // Compute reconcile rate for each family
    const result: IFamilySummaryRow[] = [];
    for (const [family, g] of groups) {
      const reconcileCount = this.countReconciledRuns(g.runIds);

      const meanScore = g.scores.reduce((a, b) => a + b, 0) / g.scores.length;
      result.push({
        family,
        taskCount: g.scores.length,
        passedCount: g.passCount,
        graded: g.scores.some((score) => score > 0 && score < 1),
        meanScore,
        delta: this.previousMeanForFamily(rows, family, tagPrefix, meanScore),
        meanPassAt1: g.passCount / g.scores.length,
        reconcileRate: g.scores.length > 0 ? reconcileCount / g.scores.length : 0,
        meanDurationMs: g.scores.length > 0 ? g.totalDuration / g.scores.length : 0,
      });
    }

    return result.sort((a, b) => a.family.localeCompare(b.family));
  }

  /**
   * Count how many of the given run IDs have a passing review-approved criterion.
   */
  private countReconciledRuns(runIds: string[]): number {
    let count = 0;
    for (const runId of runIds) {
      const crit = this.db.prepare(
        `SELECT COUNT(*) as cnt FROM eval_criteria_results WHERE run_id = ? AND criterion_id = 'review-approved' AND passed = 1`,
      ).get<{ cnt: number }>(runId);
      if (crit && crit.cnt > 0) count++;
    }
    return count;
  }

  /** Latest score per scenario minus the mean of each scenario's SECOND-latest score;
   *  `null` when no scenario in the family has been seen twice. Compared per scenario
   *  rather than per run so a changed family membership doesn't skew the denominator. */
  private previousMeanForFamily(
    rows: Array<{ scenario_id: string; tags: string | null; suite_score: number }>,
    family: string,
    tagPrefix: string,
    currentMean: number,
  ): number | null {
    const seenPerScenario = new Map<string, number[]>();
    for (const row of rows) {
      if (!this.rowHasFamily(row.tags, family, tagPrefix)) continue;
      const scores = seenPerScenario.get(row.scenario_id) ?? [];
      scores.push(row.suite_score);
      seenPerScenario.set(row.scenario_id, scores);
    }

    // `rows` arrives newest-first, so index 1 is each scenario's previous observation.
    const previous = [...seenPerScenario.values()].filter((scores) => scores.length > 1).map((scores) => scores[1]);
    if (previous.length === 0) return null;
    return currentMean - previous.reduce((a, b) => a + b, 0) / previous.length;
  }

  /** True when a stored `tags` JSON column carries the family tag. */
  private rowHasFamily(tags: string | null, family: string, tagPrefix: string): boolean {
    if (!tags) return false;
    try {
      const parsed = JSON.parse(tags) as string[];
      return parsed.some((tag) => tag.startsWith(tagPrefix) && tag === family);
    } catch {
      return false;
    }
  }

  /** Keeps only the latest run per scenario. */
  private deduplicateRuns(
    rows: Array<
      {
        run_id: string;
        scenario_id: string;
        tags: string | null;
        suite_score: number;
        passed: number;
        duration_ms: number | null;
      }
    >,
    lastPerScenario: boolean,
  ): Array<
    {
      run_id: string;
      scenario_id: string;
      tags: string | null;
      suite_score: number;
      passed: number;
      duration_ms: number | null;
    }
  > {
    if (!lastPerScenario) return rows;
    const seen = new Set<string>();
    const result: Array<
      {
        run_id: string;
        scenario_id: string;
        tags: string | null;
        suite_score: number;
        passed: number;
        duration_ms: number | null;
      }
    > = [];
    for (const row of rows) {
      if (seen.has(row.scenario_id)) continue;
      seen.add(row.scenario_id);
      result.push(row);
    }
    return result;
  }

  /**
   * Group runs by tags matching the given prefix.
   */
  private groupRunsByTag(
    rows: Array<
      {
        run_id: string;
        scenario_id: string;
        tags: string | null;
        suite_score: number;
        passed: number;
        duration_ms: number | null;
      }
    >,
    tagPrefix: string,
  ): Map<
    string,
    { scores: number[]; passCount: number; reconcileCount: number; totalDuration: number; runIds: string[] }
  > {
    const groups = new Map<
      string,
      { scores: number[]; passCount: number; reconcileCount: number; totalDuration: number; runIds: string[] }
    >();
    for (const row of rows) {
      if (!row.tags) continue;
      for (const tag of JSON.parse(row.tags) as string[]) {
        if (tag.startsWith(tagPrefix)) {
          if (!groups.has(tag)) {
            groups.set(tag, { scores: [], passCount: 0, reconcileCount: 0, totalDuration: 0, runIds: [] });
          }
          const g = groups.get(tag)!;
          g.scores.push(row.suite_score);
          g.passCount += row.passed ? 1 : 0;
          g.totalDuration += row.duration_ms ?? 0;
          g.runIds.push(row.run_id);
          break;
        }
      }
    }
    return groups;
  }

  close(): void {
    this.db.close();
  }
}
