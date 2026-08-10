/**
 * @module EvalCommands
 * @path apps/exactl/src/commands/eval_commands.ts
 * @description Provides CLI commands for evaluation runs and history queries.
 * @architectural-layer CLI
 * @related-files [packages/eval-history/mod.ts, tests/scenario_framework/runner/main.ts]
 */

import { resolve } from "@std/path";
import { BaseCommand, type ICommandContext } from "@exaix/cli/base.ts";
import { EvalSqliteStore, EXTERNAL_BENCHMARK_CAVEAT, resolveEvalDbPath } from "@exaix/eval-history";
import type { Opt, Reason } from "@exaix/core/types";

interface IRunManifest {
  scenarioId: string;
  outcome: string;
}

interface IHistoryEntry {
  run_id: string;
  scenario_id: string;
  pack?: string;
  outcome: string;
  mode: string;
  scoring_mode?: string;
  suite_score?: number;
  passed: boolean;
  timestamp: string;
}

/** A frontier cell row: per-cell mean score/cost, cost-per-solved, and Pareto marking. */
export interface IFrontierCellRow {
  cell: string;
  provider: string;
  model: string;
  runCount: number;
  passedCount: number;
  meanScore: number | undefined;
  meanCost: number | undefined;
  costPerSolved: number | undefined;
  /** True when the cell is not dominated by any other cost-reporting cell (Metric Definitions
   *  predicate). Missing-cost cells never participate in dominance and are never marked. */
  pareto: boolean;
}

/** A failure class row: overall count plus the family × cell breakdown. */
export interface IFailuresClassRow {
  className: string;
  count: number;
  familyCounts: Array<{ family: string; count: number }>;
  cellCounts: Array<{ cell: string; count: number }>;
}

/** The failures aggregation: per-class rows and the top class per cell. */
export interface IFailuresReport {
  classes: IFailuresClassRow[];
  topClassByCell: Array<{ cell: string; className: string; count: number }>;
}

/** An external-benchmark comparability row (Phase 144 Step 4): per (benchmark, version, cell) —
 *  outcome-channel resolved rate over the tasks run, task count vs the manifest's supported
 *  subset size, coverage, mean tracked cost, latest run date, and the harness+model identifiers. */
export interface IExternalCellRow {
  benchmark: string;
  benchmarkVersion: string;
  cell: string;
  provider: string;
  model: string;
  /** Tasks run in this cell (each run is one task verdict). The resolved-rate denominator. */
  tasksRun: number;
  resolvedCount: number;
  /** resolvedCount / tasksRun — never silently partial: the denominator is the tasks run. */
  resolvedRate: number;
  /** Published supported-subset size from the coverage manifest (— when unknown). */
  subsetSize: number | undefined;
  /** tasksRun / subsetSize — how much of the supported subset was exercised (— when unknown). */
  coveragePct: number | undefined;
  /** Mean of the runs' total_tracked_cost_usd (— when no run reports cost). */
  meanCostUsd: number | undefined;
  /** Latest run timestamp in the group (ISO date). */
  latestRunAt: string;
}

interface ICostReportRunRow {
  cell_id: string | null;
  provider: string | null;
  model: string | null;
  duration_ms: number | null;
  total_llm_duration_ms: number | null;
  total_tokens_prompt: number | null;
  total_tokens_completion: number | null;
  total_tokens_cache_read: number | null;
  total_tokens_cache_creation: number | null;
  total_tracked_cost_usd: number | null;
}

interface ICostReportCellGroup {
  cellId: string;
  provider: string;
  model: string;
  runs: ICostReportRunRow[];
}

const FRAMEWORK_RELATIVE_PATH = "../../../../tests/scenario_framework/runner/main.ts";
const HARNESS_LIFT_SCRIPT_RELATIVE_PATH = "../../../../scripts/run_harness_lift_report.ts";
const ABLATION_SCRIPT_RELATIVE_PATH = "../../../../scripts/run_ablation_report.ts";
/** Relative (to this file) root of the external-benchmark coverage manifests published by the
 *  batch ingest (scripts/ingest_terminal_bench.ts). Resolved per benchmark via
 *  EXTERNAL_BENCHMARK_FIXTURE_DIRS. */
const EXTERNAL_MANIFESTS_RELATIVE_DIR = "../../../../tests/scenario_framework/fixtures/external";
/** Benchmark name (as stamped on history rows) → fixture directory name. Only the benchmark
 *  shipping in this phase is mapped; an unmapped benchmark renders subset/coverage as —. */
const EXTERNAL_BENCHMARK_FIXTURE_DIRS: Record<string, string> = {
  "terminal-bench": "terminal_bench",
};
/** Shared report-table column label (check:magic: appears in 4 renderers). */
const TASKS_COLUMN = "Tasks";
/** The `--format json` output format (check:magic: appears in 3 renderers). */
const JSON_FORMAT = "json";
/** Report views that spawn a Test-layer script bridge (never imported into production). */
const SCRIPT_REPORT_VIEWS = new Set(["lift", "ablation"]);

export class EvalCommands extends BaseCommand {
  constructor(context: ICommandContext) {
    super(context);
  }

  async run(options: {
    pack?: string[];
    tag?: string[];
    scenario?: string[];
    scoreThreshold?: number;
    trials?: number;
    historyFormat?: string;
    cell?: string;
    maxCostUsd?: number;
    verbose?: boolean;
  }): Promise<void> {
    const args = buildRunArgs(options);

    const cmd = new Deno.Command("deno", { args, cwd: Deno.cwd() });
    const proc = cmd.spawn();
    const status = await proc.status;

    if (!status.success) {
      Deno.exit(status.code ?? 1);
    }
  }

  async history(options: {
    last?: number;
    scenario?: string;
    pack?: string;
    since?: string;
    format?: string;
    source?: string;
  }): Promise<void> {
    // Default: SQLite; --source jsonl falls back to JSONL file
    const useJsonl = options.source === "jsonl";

    if (useJsonl) {
      // JSONL fallback path (unchanged from before)
      const historyDir = resolve(Deno.cwd(), "tests", "scenario_framework", "output", "history");
      const historyFile = resolve(historyDir, "eval-history.jsonl");
      let lines: string[] = [];
      try {
        const content = await Deno.readTextFile(historyFile);
        lines = content.trim().split("\n").filter(Boolean);
      } catch {
        console.log("No evaluation history found.");
        return;
      }
      const entries: IHistoryEntry[] = lines.map((line) => JSON.parse(line));
      const filtered = this.applyHistoryFilters(entries, options);
      if (filtered.length === 0) {
        console.log("No matching history entries found.");
        return;
      }
      this.renderHistory(filtered, options.format);
      return;
    }

    // SQLite primary path
    const dbPath = resolveEvalDbPath();
    const store = new EvalSqliteStore(dbPath);
    try {
      store.initialize();
      const runs = store.queryRuns({
        scenario: options.scenario,
        pack: options.pack,
        last: options.last,
        since: options.since,
      });
      if (runs.length === 0) {
        console.log("No evaluation history found in SQLite.");
        return;
      }
      const entries: IHistoryEntry[] = runs.map((r) => ({
        run_id: r.run_id,
        scenario_id: r.scenario_id,
        pack: r.pack,
        outcome: r.passed ? "success" : "failure",
        mode: r.mode,
        scoring_mode: r.scoring_mode,
        suite_score: r.suite_score,
        passed: r.passed === 1,
        timestamp: r.run_timestamp,
      }));
      this.renderHistory(entries, options.format);
    } finally {
      store.close();
    }
  }

  private applyHistoryFilters(
    entries: IHistoryEntry[],
    options: { last?: number; scenario?: string; pack?: string; since?: string },
  ): IHistoryEntry[] {
    let filtered = entries;
    if (options.scenario) {
      filtered = filtered.filter((e) => e.scenario_id === options.scenario);
    }
    if (options.pack) {
      filtered = filtered.filter((e) => e.pack === options.pack);
    }
    if (options.since) {
      const sinceDate = new Date(options.since).getTime();
      filtered = filtered.filter((e) => new Date(e.timestamp).getTime() >= sinceDate);
    }
    if (options.last && options.last > 0) {
      filtered = filtered.slice(-options.last);
    }
    return filtered;
  }

  private renderHistory(entries: IHistoryEntry[], format?: Opt<string, Reason.OptionalInput>): void {
    const fmt = format ?? "table";
    if (fmt === JSON_FORMAT) {
      console.log(JSON.stringify(entries, null, 2));
    } else {
      renderHistoryTable(entries);
    }
  }

  /**
   * `--view cost` renders a per-cell (cell_id/provider/model) comparison table of mean
   * duration_ms, mean llm_duration_ms, total tokens, and total/mean tracked_cost_usd — sourced
   * exclusively from eval_runs.total_tracked_cost_usd (Phase 140a Step 4). Absent values render
   * "—", never "0": a cell whose every run had no tracked cost (all direct-API) is unknown
   * spend, not free spend, and must never be confused with a predicted-cost figure.
   *
   * `--group-by subsystem|entity` renders per-family summary rows grouped by the chosen
   * tag prefix (subsystem: or entity:) using store.summarizeByTag.
   */
  report(options: {
    view?: string;
    scenario?: string;
    last?: number;
    pack?: string;
    groupBy?: string;
    /** Output format (e.g. "json" for the frontier view's CI trend output). */
    format?: string;
    /** Explicit eval.db path override (test-supporting). When absent, resolves from
     *  EXA_EVAL_DB_PATH or the process cwd. Tests pass it so the process-global cwd
     *  (shared across `deno test --parallel` worker threads) never backs the path. */
    dbPath?: Opt<string, Reason.OptionalInput>;
    /** Explicit coverage-manifest path override for `--view external` (test-supporting).
     *  When absent, resolves per benchmark from the framework fixtures dir. */
    externalManifestPath?: Opt<string, Reason.OptionalInput>;
  }): void {
    const view = options.view ?? "cost";
    const resolveDb = () => options.dbPath ?? resolveEvalDbPath();

    if (options.groupBy) {
      this.renderGroupedReport(options);
      return;
    }
    if (SCRIPT_REPORT_VIEWS.has(view)) {
      this.renderScriptView(view, options.scenario, options.pack, options.dbPath);
      return;
    }
    if (view === "cost") {
      const dbPath = resolveDb();
      const store = new EvalSqliteStore(dbPath);
      try {
        store.initialize();
        const runs = store.queryRuns({ scenario: options.scenario, last: options.last });
        if (runs.length === 0) {
          console.log("No evaluation history found for cost report.");
          return;
        }
        renderCostReportTable(groupRunsByCell(runs));
      } finally {
        store.close();
      }
      return;
    }

    if (view === "frontier") {
      this.renderFrontierReport(options);
      return;
    }
    if (view === "failures") {
      this.renderFailuresReport(options);
      return;
    }

    if (view === "families") {
      const dbPath = resolveDb();
      const store = new EvalSqliteStore(dbPath);
      try {
        store.initialize();
        const summary = store.summarizeByTag("task:", { pack: options.pack });
        if (summary.length === 0) {
          console.log("No family summary data found.");
          return;
        }
        console.log("Family Report");
        console.log("-------------");
        console.log(
          `  ${"Family".padEnd(25)} ${TASKS_COLUMN.padEnd(6)} ${"Mean".padEnd(7)} ${"Pass@1".padEnd(8)} ${
            "Reconcile".padEnd(10)
          } ${"Duration".padEnd(10)}`,
        );
        for (const row of summary) {
          console.log(
            `  ${row.family.padEnd(25)} ${String(row.taskCount).padEnd(6)} ${row.meanScore.toFixed(3).padEnd(7)} ${
              row.meanPassAt1.toFixed(3).padEnd(8)
            } ${(row.reconcileRate * 100).toFixed(0).padEnd(9)}% ${
              Math.round(row.meanDurationMs).toString().padEnd(9)
            }ms`,
          );
        }
      } finally {
        store.close();
      }
      return;
    }

    if (view === "external") {
      this.renderExternalReport(options);
      return;
    }

    console.log(
      `Unknown report view: ${view}. Supported views: cost, families, lift, ablation, frontier, failures, external`,
    );
  }

  private renderGroupedReport(options: {
    groupBy?: string;
    pack?: string;
    dbPath?: string;
  }): void {
    const dbPath = options.dbPath ?? resolveEvalDbPath();
    const store = new EvalSqliteStore(dbPath);
    try {
      store.initialize();
      const tagPrefix = options.groupBy === "subsystem" ? "subsystem:" : "entity:";
      const summary = store.summarizeByTag(tagPrefix, { pack: options.pack });
      if (summary.length === 0) {
        console.log("No matching summary data found for the requested group.");
        return;
      }
      console.log(
        `${options.groupBy === "subsystem" ? "Subsystem" : "Entity"} Report`,
      );
      console.log("-".repeat(70));
      console.log(
        `  ${"Name".padEnd(30)} ${TASKS_COLUMN.padEnd(6)} ${"Passed".padEnd(8)} ${"Mean".padEnd(7)} ${
          "Delta".padEnd(8)
        } ${"Pass@1".padEnd(8)} ${"Reconcile".padEnd(10)} ${"Duration".padEnd(10)}`,
      );
      for (const row of summary) {
        // A mean only where the criteria are graded. Over a pack of yes/no contract assertions it
        // is the pass rate wearing three decimal places, and reading 0.971 as "97% healthy" is
        // how a dead subsystem looked healthy in Phase 142 Step 17.
        const mean = row.graded ? row.meanScore.toFixed(3) : "—";
        // "—" on a first run: there is nothing for a trend to be against, and printing +0.000
        // would read as "no change" rather than "no comparison".
        const delta = row.delta === null ? "—" : `${row.delta >= 0 ? "+" : ""}${row.delta.toFixed(3)}`;
        console.log(
          `  ${row.family.padEnd(30)} ${String(row.taskCount).padEnd(6)} ${
            `${row.passedCount}/${row.taskCount}`.padEnd(8)
          } ${mean.padEnd(7)} ${delta.padEnd(8)} ${row.meanPassAt1.toFixed(3).padEnd(8)} ${
            (row.reconcileRate * 100).toFixed(0).padEnd(9)
          }% ${Math.round(row.meanDurationMs).toString().padEnd(9)}ms`,
        );
      }
    } finally {
      store.close();
    }
  }

  private renderFrontierReport(options: {
    scenario?: string;
    last?: number;
    dbPath?: string;
    format?: string;
  }): void {
    const dbPath = options.dbPath ?? resolveEvalDbPath();
    const store = new EvalSqliteStore(dbPath);
    try {
      store.initialize();
      const runs = store.queryRuns({ scenario: options.scenario, last: options.last });
      const rows = computeFrontierRows(runs);
      if (rows.length === 0) {
        console.log("No frontier data found in history.");
        return;
      }
      if (options.format === JSON_FORMAT) {
        console.log(JSON.stringify(rows, null, 2));
      } else {
        renderFrontierTable(rows);
      }
    } finally {
      store.close();
    }
  }

  private renderFailuresReport(options: {
    scenario?: string;
    last?: number;
    dbPath?: string;
    format?: string;
  }): void {
    const dbPath = options.dbPath ?? resolveEvalDbPath();
    const store = new EvalSqliteStore(dbPath);
    try {
      store.initialize();
      const runs = store.queryRuns({ scenario: options.scenario, last: options.last });
      const report = computeFailuresReport(runs);
      if (options.format === JSON_FORMAT) {
        console.log(JSON.stringify(report, null, 2));
      } else {
        renderFailuresTable(report);
      }
    } finally {
      store.close();
    }
  }

  /**
   * `--view external` (Phase 144 Step 4): external-benchmark comparability per
   * (benchmark, benchmark_version, cell). Resolved rate is the outcome-channel pass over the
   * tasks run — its denominator is never silently partial — stated next to the manifest's
   * supported-subset size and coverage. Mean cost uses only `total_tracked_cost_usd` runs
   * (never a predicted figure). Renders the single-sourced caveat block below the table.
   */
  private renderExternalReport(options: {
    pack?: string;
    dbPath?: string;
    format?: string;
    externalManifestPath?: string;
  }): void {
    const dbPath = options.dbPath ?? resolveEvalDbPath();
    const store = new EvalSqliteStore(dbPath);
    try {
      store.initialize();
      const runs = store.queryExternalRuns({ pack: options.pack });
      if (runs.length === 0) {
        console.log("No external-benchmark runs found in history.");
        return;
      }
      const subsetByVersion = new Map<string, number>();
      for (const run of runs) {
        if (!run.benchmark || !run.benchmark_version) continue;
        const key = `${run.benchmark}-${run.benchmark_version}`;
        if (subsetByVersion.has(key)) continue;
        const manifestPath = options.externalManifestPath ?? resolveExternalManifestPath(run.benchmark);
        if (!manifestPath) continue;
        const manifest = readExternalManifest(manifestPath);
        if (manifest && manifest.benchmarkVersion === run.benchmark_version) {
          subsetByVersion.set(key, manifest.supportedCount);
        }
      }
      const rows = computeExternalRows(runs, subsetByVersion);
      if (options.format === JSON_FORMAT) {
        console.log(JSON.stringify({ caveat: EXTERNAL_BENCHMARK_CAVEAT, rows }, null, 2));
      } else {
        renderExternalTable(rows);
      }
    } finally {
      store.close();
    }
  }

  private renderScriptView(
    view: string,
    scenario?: Opt<string, Reason.QueryFilter>,
    pack?: Opt<string, Reason.QueryFilter>,
    dbPath?: Opt<string, Reason.OptionalInput>,
  ): void {
    const isLift = view === "lift";
    const scriptPath = isLift ? resolveHarnessLiftScriptPath() : resolveAblationScriptPath();
    const dbPathResolved = dbPath ?? resolveEvalDbPath();
    const args = ["run", "--allow-all", scriptPath, "--db", dbPathResolved];
    if (scenario) {
      args.push("--scenario", scenario);
    }
    if (pack) {
      args.push("--pack", pack);
    }
    const output = new Deno.Command("deno", { args, cwd: Deno.cwd() }).outputSync();
    if (output.code !== 0) {
      console.error(
        `${isLift ? "Harness lift" : "Ablation"} report failed: ${new TextDecoder().decode(output.stderr)}`,
      );
      return;
    }
    const stdout = new TextDecoder().decode(output.stdout);
    if (isLift) {
      renderHarnessLiftTable(stdout);
    } else {
      renderAblationTable(stdout);
    }
  }

  compare(runA: string, runB: string): void {
    const dbPath = resolveEvalDbPath();
    const store = new EvalSqliteStore(dbPath);
    try {
      store.initialize();
      const result = store.compareRuns(runA, runB);
      if (!result.runA && !result.runB) {
        console.log("Neither run found in SQLite history.");
        return;
      }
      console.log(`Comparing run A (${runA}) vs run B (${runB}):`);
      console.log(`  Score delta: ${result.scoreDelta > 0 ? "+" : ""}${result.scoreDelta.toFixed(3)}`);
      if (result.runA) {
        console.log(
          `  Run A: scenario=${result.runA.scenario_id}, score=${result.runA.suite_score}, timestamp=${result.runA.run_timestamp}`,
        );
      }
      if (result.runB) {
        console.log(
          `  Run B: scenario=${result.runB.scenario_id}, score=${result.runB.suite_score}, timestamp=${result.runB.run_timestamp}`,
        );
      }
      if (result.stepsA.length > 0 || result.stepsB.length > 0) {
        console.log(`\nSteps comparison:`);
        const maxSteps = Math.max(result.stepsA.length, result.stepsB.length);
        for (let i = 0; i < maxSteps; i++) {
          const stepA = result.stepsA[i];
          const stepB = result.stepsB[i];
          const stepId = stepA?.step_id ?? stepB?.step_id ?? `step-${i}`;
          const scoreA = stepA?.score ?? 0;
          const scoreB = stepB?.score ?? 0;
          console.log(
            `  ${stepId}: ${scoreA.toFixed(2)} → ${scoreB.toFixed(2)} (${(scoreB - scoreA > 0 ? "+" : "")}${
              (scoreB - scoreA).toFixed(2)
            })`,
          );
        }
      }
    } finally {
      store.close();
    }
  }
}

function resolveFrameworkPath(): string {
  const envPath = Deno.env.get("EXA_FRAMEWORK_PATH");
  if (envPath) {
    return resolve(envPath, "runner/main.ts");
  }
  return resolve(new URL(".", import.meta.url).pathname, FRAMEWORK_RELATIVE_PATH);
}

function resolveHarnessLiftScriptPath(): string {
  return resolve(new URL(".", import.meta.url).pathname, HARNESS_LIFT_SCRIPT_RELATIVE_PATH);
}

function resolveAblationScriptPath(): string {
  return resolve(new URL(".", import.meta.url).pathname, ABLATION_SCRIPT_RELATIVE_PATH);
}

export function buildRunArgs(options: {
  pack?: string[];
  tag?: string[];
  scenario?: string[];
  scoreThreshold?: number;
  trials?: number;
  historyFormat?: string;
  cell?: string;
  maxCostUsd?: number;
  verbose?: boolean;
}): string[] {
  const frameworkPath = resolveFrameworkPath();
  const outputDir = resolve(Deno.cwd(), "tests", "scenario_framework", "output");

  const args = [
    "run",
    "--allow-all",
    frameworkPath,
    "--output",
    outputDir,
    "--mode",
    "auto",
  ];

  if (options.verbose) args.push("--verbose");
  if (options.pack) { for (const p of options.pack) args.push("--pack", p); }
  if (options.tag) { for (const t of options.tag) args.push("--tag", t); }
  if (options.scenario) { for (const s of options.scenario) args.push("--scenario", s); }
  if (options.scoreThreshold !== undefined) args.push("--score-threshold", String(options.scoreThreshold));
  if (options.trials !== undefined && options.trials > 1) args.push("--trials", String(options.trials));
  if (options.historyFormat !== undefined) args.push("--history-format", options.historyFormat);
  if (options.cell !== undefined) args.push("--cell", options.cell);
  if (options.maxCostUsd !== undefined) args.push("--max-cost-usd", String(options.maxCostUsd));

  args.push("--eval-mode");

  return args;
}

const COST_REPORT_UNKNOWN_CELL = "unknown-cell";
const COST_REPORT_UNKNOWN_PROVIDER = "unknown-provider";
const COST_REPORT_UNKNOWN_MODEL = "unknown-model";
const COST_REPORT_ABSENT_VALUE = "—";

/** Groups runs by cell_id/provider/model — absent identity fields fall back to an explicit
 *  "unknown-*" bucket so ungrouped runs are still visible rather than silently dropped. */
function groupRunsByCell(runs: ICostReportRunRow[]): ICostReportCellGroup[] {
  const groups = new Map<string, ICostReportCellGroup>();
  for (const run of runs) {
    const cellId = run.cell_id ?? COST_REPORT_UNKNOWN_CELL;
    const provider = run.provider ?? COST_REPORT_UNKNOWN_PROVIDER;
    const model = run.model ?? COST_REPORT_UNKNOWN_MODEL;
    const key = `${cellId}-${provider}-${model}`;
    const existing = groups.get(key);
    if (existing) {
      existing.runs.push(run);
    } else {
      groups.set(key, { cellId, provider, model, runs: [run] });
    }
  }
  return Array.from(groups.values());
}

function mean(values: number[]): number | undefined {
  return values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : undefined;
}

function sum(values: number[]): number | undefined {
  return values.length > 0 ? values.reduce((a, b) => a + b, 0) : undefined;
}

function formatNumberOrAbsent(value?: Opt<number, Reason.OptionalInput>, digits = 0): string {
  return value === undefined ? COST_REPORT_ABSENT_VALUE : value.toFixed(digits);
}

/** Structural subset of the eval-history run row the frontier needs. */
interface IFrontierRunRow {
  cell_id: string | null;
  provider: string | null;
  model: string | null;
  suite_score: number;
  passed: number;
  total_tracked_cost_usd: number | null;
}

/** Structural subset of the eval-history run row the failures view needs. */
interface IFailuresRunRow {
  cell_id: string | null;
  tags: string | null;
  failure_classes: string | null;
}

const FAMILY_TAG_PREFIX = "task:";
const UNKNOWN_FAMILY = "unknown-family";

/**
 * Compute the accuracy-vs-cost frontier over history runs (Phase 143 Step 4). Per cell:
 * mean score, mean tracked cost (only runs that report cost), cost_per_solved =
 * Σ cost / count(passed) (— when no passes), and the Pareto marking per the Metric Definitions
 * predicate: A dominates B iff meanScore(A) >= meanScore(B) AND meanCost(A) <= meanCost(B) with
 * at least one strict inequality; exact ties are co-dominant (both un-dominated); a cell with no
 * cost data is excluded from dominance entirely.
 */
export function computeFrontierRows(runs: IFrontierRunRow[]): IFrontierCellRow[] {
  const groups = new Map<string, IFrontierRunRow[]>();
  for (const run of runs) {
    const cell = run.cell_id ?? COST_REPORT_UNKNOWN_CELL;
    const provider = run.provider ?? COST_REPORT_UNKNOWN_PROVIDER;
    const model = run.model ?? COST_REPORT_UNKNOWN_MODEL;
    const key = `${cell}-${provider}-${model}`;
    const group = groups.get(key) ?? [];
    group.push(run);
    groups.set(key, group);
  }
  const rows: IFrontierCellRow[] = [];
  for (const [, groupRuns] of groups) {
    const passedCount = groupRuns.filter((r) => r.passed === 1).length;
    const costRuns = groupRuns.filter((r) => r.total_tracked_cost_usd !== null) as Array<
      IFrontierRunRow & { total_tracked_cost_usd: number }
    >;
    const meanCost = costRuns.length > 0 ? mean(costRuns.map((r) => r.total_tracked_cost_usd)) : undefined;
    const costTotal = costRuns.length > 0 ? costRuns.reduce((acc, r) => acc + r.total_tracked_cost_usd, 0) : undefined;
    rows.push({
      cell: groupRuns[0].cell_id ?? COST_REPORT_UNKNOWN_CELL,
      provider: groupRuns[0].provider ?? COST_REPORT_UNKNOWN_PROVIDER,
      model: groupRuns[0].model ?? COST_REPORT_UNKNOWN_MODEL,
      runCount: groupRuns.length,
      passedCount,
      meanScore: mean(groupRuns.map((r) => r.suite_score)),
      meanCost,
      costPerSolved: costTotal !== undefined && passedCount > 0 ? costTotal / passedCount : undefined,
      pareto: false,
    });
  }
  // Pareto pass: only cells that report cost participate; A dominates B iff
  // meanScore(A) >= meanScore(B) && meanCost(A) <= meanCost(B), at least one strict.
  const costRows = rows.filter((r) => r.meanCost !== undefined) as Array<
    IFrontierCellRow & { meanCost: number }
  >;
  for (const row of costRows) {
    const dominated = costRows.some((other) =>
      other !== row &&
      other.meanScore! >= row.meanScore! &&
      other.meanCost <= row.meanCost &&
      (other.meanScore! > row.meanScore! || other.meanCost < row.meanCost)
    );
    row.pareto = !dominated;
  }

  return rows;
}

/** Render the frontier table: per-cell score/cost/cost-per-solved with Pareto markers. */
function renderFrontierTable(rows: IFrontierCellRow[]): void {
  console.log("Accuracy vs Cost Frontier");
  console.log("-".repeat(100));
  console.log(
    `  ${padRight("Cell", 24)} ${padRight("Runs", 6)} ${padRight("Solved", 8)} ${padRight("MeanScore", 10)} ${
      padRight("MeanCost", 10)
    } ${padRight("Cost/Solved", 12)} Pareto`,
  );
  for (const row of rows) {
    console.log(
      `  ${padRight(row.cell.slice(0, 24), 24)} ${padRight(String(row.runCount), 6)} ${
        padRight(String(row.passedCount), 8)
      } ${padRight(formatNumberOrAbsent(row.meanScore, 3), 10)} ${
        padRight(formatNumberOrAbsent(row.meanCost, 4), 10)
      } ${padRight(formatNumberOrAbsent(row.costPerSolved, 4), 12)} ${row.pareto ? "◀ pareto" : "—"}`,
    );
  }
}

/**
 * Aggregate seeded history runs into the failures report (Phase 143 Step 5): per-class counts
 * with the class × family × cell breakdown, and the top class per cell. `failure_classes` and
 * `tags` are JSON strings in the row; family is the first `task:` tag.
 */
export function computeFailuresReport(runs: IFailuresRunRow[]): IFailuresReport {
  const classMap = new Map<string, { count: number; families: Map<string, number>; cells: Map<string, number> }>();
  const cellClassCounts = new Map<string, Map<string, number>>();

  for (const run of runs) {
    let classes: string[] = [];
    try {
      classes = run.failure_classes ? JSON.parse(run.failure_classes) as string[] : [];
    } catch {
      classes = [];
    }
    let tags: string[] = [];
    try {
      tags = run.tags ? JSON.parse(run.tags) as string[] : [];
    } catch {
      tags = [];
    }
    const family = tags.find((t) => t.startsWith(FAMILY_TAG_PREFIX)) ?? UNKNOWN_FAMILY;
    const cell = run.cell_id ?? COST_REPORT_UNKNOWN_CELL;

    for (const className of classes) {
      let acc = classMap.get(className);
      if (!acc) {
        acc = { count: 0, families: new Map(), cells: new Map() };
        classMap.set(className, acc);
      }
      acc.count++;
      acc.families.set(family, (acc.families.get(family) ?? 0) + 1);
      acc.cells.set(cell, (acc.cells.get(cell) ?? 0) + 1);

      const perCell = cellClassCounts.get(cell) ?? new Map<string, number>();
      perCell.set(className, (perCell.get(className) ?? 0) + 1);
      cellClassCounts.set(cell, perCell);
    }
  }

  const classes: IFailuresClassRow[] = [...classMap.entries()]
    .map(([className, acc]) => ({
      className,
      count: acc.count,
      familyCounts: [...acc.families.entries()].map(([family, count]) => ({ family, count })),
      cellCounts: [...acc.cells.entries()].map(([cell, count]) => ({ cell, count })),
    }))
    .sort((a, b) => b.count - a.count || a.className.localeCompare(b.className));

  const topClassByCell = [...cellClassCounts.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([cell, counts]) => {
      const [className, count] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
      return { cell, className, count };
    });

  return { classes, topClassByCell };
}

/** Render the failures report: per-class rows with family/cell counts + top class per cell. */
function renderFailuresTable(report: IFailuresReport): void {
  if (report.classes.length === 0) {
    console.log("No failure classes found in history.");
    return;
  }
  console.log("Failure Classes");
  console.log("-".repeat(100));
  console.log(
    `  ${padRight("Class", 32)} ${padRight("Count", 6)} ${padRight("Families", 30)} ${padRight("Cells", 28)}`,
  );
  for (const row of report.classes) {
    console.log(
      `  ${padRight(row.className.slice(0, 32), 32)} ${padRight(String(row.count), 6)} ${
        padRight(row.familyCounts.map((f) => `${f.family}(${f.count})`).join(", ").slice(0, 30), 30)
      } ${padRight(row.cellCounts.map((c) => `${c.cell}(${c.count})`).join(", ").slice(0, 28), 28)}`,
    );
  }
  if (report.topClassByCell.length > 0) {
    console.log("\nTop class per cell:");
    for (const top of report.topClassByCell) {
      console.log(`  ${top.cell}: ${top.className} (${top.count})`);
    }
  }
}

/**
 * Resolve the coverage manifest path for a benchmark (Phase 144 Step 4): the manifest the
 * batch ingest publishes under tests/scenario_framework/fixtures/external/<dir>/manifest.json.
 * Unmapped benchmarks resolve to undefined and render subset/coverage as —.
 */
function resolveExternalManifestPath(benchmark: string): string | undefined {
  const dir = EXTERNAL_BENCHMARK_FIXTURE_DIRS[benchmark];
  if (!dir) return undefined;
  return resolve(new URL(".", import.meta.url).pathname, EXTERNAL_MANIFESTS_RELATIVE_DIR, dir, "manifest.json");
}

/** The coverage-manifest fields the external view needs (full shape lives in
 *  scripts/ingest_terminal_bench.ts — the view only consumes subset provenance). */
interface IExternalManifestInfo {
  benchmarkVersion: string;
  supportedCount: number;
}

/** Read + parse a coverage manifest; missing/unparseable → undefined (subset/coverage —). */
function readExternalManifest(path: string): IExternalManifestInfo | undefined {
  try {
    const raw = JSON.parse(Deno.readTextFileSync(path)) as {
      benchmark_version?: string;
      supported_count?: number;
    };
    if (typeof raw.benchmark_version !== "string" || typeof raw.supported_count !== "number") {
      return undefined;
    }
    return { benchmarkVersion: raw.benchmark_version, supportedCount: raw.supported_count };
  } catch {
    return undefined;
  }
}

/** Structural subset of the eval-history run row the external view needs. */
interface IExternalRunRow {
  passed: number;
  run_timestamp: string;
  provider: string | null;
  model: string | null;
  cell_id: string | null;
  total_tracked_cost_usd: number | null;
  benchmark: string | null;
  benchmark_version: string | null;
}

/**
 * Compute the external-benchmark comparability rows (Phase 144 Step 4). Per
 * (benchmark, benchmark_version, cell_id): tasksRun is the number of run verdicts — the
 * resolved-rate denominator, never silently partial — resolvedRate = passed / tasksRun, and
 * subsetSize/coveragePct come from the coverage manifest keyed by benchmark_version (— when
 * unknown). Mean cost averages only runs that report total_tracked_cost_usd.
 */
export function computeExternalRows(
  runs: IExternalRunRow[],
  subsetByVersion: ReadonlyMap<string, number>,
): IExternalCellRow[] {
  const groups = new Map<string, IExternalRunRow[]>();
  for (const run of runs) {
    const cell = run.cell_id ?? COST_REPORT_UNKNOWN_CELL;
    const key = `${run.benchmark ?? ""}-${run.benchmark_version ?? ""}-${cell}`;
    const group = groups.get(key) ?? [];
    group.push(run);
    groups.set(key, group);
  }

  const rows: IExternalCellRow[] = [];
  for (const [, groupRuns] of groups) {
    const benchmark = groupRuns[0].benchmark ?? "";
    const benchmarkVersion = groupRuns[0].benchmark_version ?? "";
    const resolvedCount = groupRuns.filter((r) => r.passed === 1).length;
    const costRuns = groupRuns.filter((r) => r.total_tracked_cost_usd !== null) as Array<
      IExternalRunRow & { total_tracked_cost_usd: number }
    >;
    const subsetSize = subsetByVersion.get(`${benchmark}-${benchmarkVersion}`);
    rows.push({
      benchmark,
      benchmarkVersion,
      cell: groupRuns[0].cell_id ?? COST_REPORT_UNKNOWN_CELL,
      provider: groupRuns[0].provider ?? COST_REPORT_UNKNOWN_PROVIDER,
      model: groupRuns[0].model ?? COST_REPORT_UNKNOWN_MODEL,
      tasksRun: groupRuns.length,
      resolvedCount,
      resolvedRate: resolvedCount / groupRuns.length,
      subsetSize,
      coveragePct: subsetSize !== undefined ? (groupRuns.length / subsetSize) * 100 : undefined,
      meanCostUsd: costRuns.length > 0 ? mean(costRuns.map((r) => r.total_tracked_cost_usd)) : undefined,
      latestRunAt: groupRuns.map((r) => r.run_timestamp).sort().at(-1) ?? "",
    });
  }

  return rows.sort(
    (a, b) =>
      a.benchmark.localeCompare(b.benchmark) ||
      a.benchmarkVersion.localeCompare(b.benchmarkVersion) ||
      a.cell.localeCompare(b.cell),
  );
}

/** Render the external-benchmark comparability table + the single-sourced caveat block. */
function renderExternalTable(rows: IExternalCellRow[]): void {
  console.log("External Benchmark Comparability");
  console.log("-".repeat(120));
  console.log(
    `  ${padRight("Benchmark", 14)} ${padRight("Version", 12)} ${padRight("Cell", 22)} ${padRight("Provider", 10)} ${
      padRight("Model", 16)
    } ${padRight(TASKS_COLUMN, 6)} ${padRight("Resolved", 9)} ${padRight("Rate", 7)} ${padRight("Subset", 8)} ${
      padRight("Coverage", 10)
    } ${padRight("MeanCost", 10)} RunDate`,
  );
  for (const row of rows) {
    const coverage = row.coveragePct === undefined ? COST_REPORT_ABSENT_VALUE : `${row.coveragePct.toFixed(0)}%`;
    console.log(
      `  ${padRight(row.benchmark.slice(0, 14), 14)} ${padRight(row.benchmarkVersion.slice(0, 12), 12)} ${
        padRight(row.cell.slice(0, 22), 22)
      } ${padRight(row.provider.slice(0, 10), 10)} ${padRight(row.model.slice(0, 16), 16)} ${
        padRight(String(row.tasksRun), 6)
      } ${padRight(`${row.resolvedCount}/${row.tasksRun}`, 9)} ${
        padRight((row.resolvedRate * 100).toFixed(0) + "%", 7)
      } ${padRight(formatNumberOrAbsent(row.subsetSize), 8)} ${padRight(coverage, 10)} ${
        padRight(formatNumberOrAbsent(row.meanCostUsd, 4), 10)
      } ${row.latestRunAt.slice(0, 10)}`,
    );
  }
  console.log(`\nCaveat: ${EXTERNAL_BENCHMARK_CAVEAT}`);
}

function renderCostReportTable(groups: ICostReportCellGroup[]): void {
  const header = `${padRight("CELL", 24)} | ${padRight("PROVIDER", 14)} | ${padRight("MODEL", 18)} | ${
    padRight("MEAN DURATION_MS", 16)
  } | ${padRight("MEAN LLM_MS", 12)} | ${padRight("TOKENS (P/C)", 16)} | ${padRight("TOTAL COST", 12)} | MEAN COST`;
  const sep = "-".repeat(header.length);
  console.log(header);
  console.log(sep);

  for (const group of groups) {
    const durations = group.runs.map((r) => r.duration_ms).filter((v): v is number => v !== null);
    const llmDurations = group.runs.map((r) => r.total_llm_duration_ms).filter((v): v is number => v !== null);
    const tokensPrompt = sum(group.runs.map((r) => r.total_tokens_prompt).filter((v): v is number => v !== null));
    const tokensCompletion = sum(
      group.runs.map((r) => r.total_tokens_completion).filter((v): v is number => v !== null),
    );
    const trackedCosts = group.runs.map((r) => r.total_tracked_cost_usd).filter((v): v is number => v !== null);
    const totalCost = sum(trackedCosts);
    const meanCost = mean(trackedCosts);

    console.log(
      `${padRight(group.cellId, 24)} | ${padRight(group.provider, 14)} | ${padRight(group.model, 18)} | ${
        padRight(formatNumberOrAbsent(mean(durations)), 16)
      } | ${padRight(formatNumberOrAbsent(mean(llmDurations)), 12)} | ${
        padRight(`${tokensPrompt ?? COST_REPORT_ABSENT_VALUE}/${tokensCompletion ?? COST_REPORT_ABSENT_VALUE}`, 16)
      } | ${padRight(formatNumberOrAbsent(totalCost, 2), 12)} | ${formatNumberOrAbsent(meanCost, 2)}`,
    );
  }
}

function renderHistoryTable(entries: IHistoryEntry[]): void {
  const header = `${padRight("RUN ID", 36)} | ${padRight("SCENARIO", 28)} | ${padRight("OUTCOME", 16)} | ${
    padRight("SCORE", 8)
  } | ${padRight("PASSED", 8)} | ${padRight("SCORING", 9)} | TIMESTAMP`;
  const sep = "-".repeat(header.length);
  console.log(header);
  console.log(sep);

  for (const entry of entries) {
    const score = entry.suite_score !== undefined ? entry.suite_score.toFixed(2) : "N/A";
    const passed = entry.passed ? "✓" : "✗";
    const scoring = entry.scoring_mode ?? "additive";
    const ts = entry.timestamp.slice(0, 19).replace("T", " ");
    console.log(
      `${padRight(entry.run_id.slice(0, 36), 36)} | ${padRight(entry.scenario_id.slice(0, 28), 28)} | ${
        padRight(entry.outcome.slice(0, 16), 16)
      } | ${padRight(score, 8)} | ${padRight(passed, 8)} | ${padRight(scoring, 9)} | ${ts}`,
    );
  }
}

function padRight(s: string, len: number): string {
  return s.length >= len ? s : s + " ".repeat(len - s.length);
}

interface IHarnessLiftViewFamilyRow {
  family: string;
  tool: string;
  provider: string;
  model: string | null;
  taskCount: number;
  comparison: {
    meanDelta: number;
    stdevDelta: number;
    noEffect: boolean;
  };
  basis: {
    controlCell: string;
    treatmentCell: string;
    controlRunIds: string[];
    treatmentRunIds: string[];
    unmatchedTaskIds: string[];
  };
}

interface IHarnessLiftViewReport {
  arm: { kind: string; metric: string };
  families: IHarnessLiftViewFamilyRow[];
  unmatchedWarningCount: number;
}

function renderHarnessLiftTable(stdout: string): void {
  let report: IHarnessLiftViewReport;
  try {
    report = JSON.parse(stdout) as IHarnessLiftViewReport;
  } catch {
    console.error("Harness lift report produced unparseable output.");
    return;
  }
  if (report.families.length === 0) {
    console.log("No harness-lift comparisons found in history.");
    return;
  }
  console.log(`Harness Lift Report (${report.arm.kind} / ${report.arm.metric})`);
  console.log("-".repeat(100));
  console.log(
    `  ${padRight("Family", 24)} ${padRight("Tool", 12)} ${padRight("Provider", 10)} ${padRight("Model", 20)} ${
      padRight(TASKS_COLUMN, 6)
    } ${padRight("MeanDelta", 10)} ${padRight("StdevDelta", 10)} NoEffect`,
  );
  for (const family of report.families) {
    const meanDelta = `${family.comparison.meanDelta >= 0 ? "+" : ""}${family.comparison.meanDelta.toFixed(3)}`;
    const verdict = family.comparison.noEffect ? "no-effect" : "effect";
    console.log(
      `  ${padRight(family.family, 24)} ${padRight(family.tool, 12)} ${padRight(family.provider, 10)} ${
        padRight(family.model ?? "—", 20)
      } ${padRight(String(family.taskCount), 6)} ${padRight(meanDelta, 10)} ${
        padRight(family.comparison.stdevDelta.toFixed(3), 10)
      } ${verdict}`,
    );
    console.log(
      `  basis: control=${family.basis.controlCell} (runs: ${
        family.basis.controlRunIds.join(", ") || "—"
      }) | treatment=${family.basis.treatmentCell} (runs: ${family.basis.treatmentRunIds.join(", ") || "—"})`,
    );
    if (family.basis.unmatchedTaskIds.length > 0) {
      console.log(`  excluded (no matched pair): ${family.basis.unmatchedTaskIds.join(", ")}`);
    }
  }
  if (report.unmatchedWarningCount > 0) {
    console.log(
      `Warning: ${report.unmatchedWarningCount} unmatched task(s) had no matched pair and were excluded`,
    );
  }
}

interface IAblationViewFamilyRow {
  family: string;
  tool: string;
  provider: string;
  model: string | null;
  subsystem: string;
  taskCount: number;
  comparison: {
    meanDelta: number;
    stdevDelta: number;
    noEffect: boolean;
  };
  basis: {
    controlCell: string;
    treatmentCell: string;
    controlRunIds: string[];
    treatmentRunIds: string[];
    unmatchedTaskIds: string[];
  };
}

interface IAblationViewReport {
  subsystems: { subsystem: string; kind: string }[];
  families: IAblationViewFamilyRow[];
  unmatchedWarningCount: number;
}

function renderAblationTable(stdout: string): void {
  let report: IAblationViewReport;
  try {
    report = JSON.parse(stdout) as IAblationViewReport;
  } catch {
    console.error("Ablation report produced unparseable output.");
    return;
  }
  if (report.families.length === 0) {
    console.log("No ablation comparisons found in history.");
    return;
  }
  const armLabel = report.subsystems
    .map((s) => `${s.subsystem} (${s.kind})`)
    .join(", ");
  console.log(`Ablation Report — arms: ${armLabel}`);
  console.log("-".repeat(100));
  console.log(
    `  ${padRight("Family", 24)} ${padRight("Subsystem", 16)} ${padRight("Tool", 12)} ${padRight("Provider", 10)} ${
      padRight(TASKS_COLUMN, 6)
    } ${padRight("MeanDelta", 10)} ${padRight("StdevDelta", 10)} NoEffect`,
  );
  for (const family of report.families) {
    const meanDelta = `${family.comparison.meanDelta >= 0 ? "+" : ""}${family.comparison.meanDelta.toFixed(3)}`;
    const verdict = family.comparison.noEffect ? "no-effect" : "effect";
    console.log(
      `  ${padRight(family.family, 24)} ${padRight(family.subsystem, 16)} ${padRight(family.tool, 12)} ${
        padRight(family.provider, 10)
      } ${padRight(String(family.taskCount), 6)} ${padRight(meanDelta, 10)} ${
        padRight(family.comparison.stdevDelta.toFixed(3), 10)
      } ${verdict}`,
    );
    console.log(
      `  basis: control=${family.basis.controlCell} (runs: ${
        family.basis.controlRunIds.join(", ") || "—"
      }) | treatment=${family.basis.treatmentCell} (runs: ${family.basis.treatmentRunIds.join(", ") || "—"})`,
    );
    if (family.basis.unmatchedTaskIds.length > 0) {
      console.log(`  excluded (no matched pair): ${family.basis.unmatchedTaskIds.join(", ")}`);
    }
  }
  if (report.unmatchedWarningCount > 0) {
    console.log(
      `Warning: ${report.unmatchedWarningCount} unmatched task(s) had no matched pair and were excluded`,
    );
  }
}
