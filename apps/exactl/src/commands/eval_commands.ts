/**
 * @module EvalCommands
 * @path apps/exactl/src/commands/eval_commands.ts
 * @description Provides CLI commands for evaluation runs and history queries.
 * @architectural-layer CLI
 * @related-files [packages/eval-history/mod.ts, tests/scenario_framework/runner/main.ts]
 */

import { resolve } from "@std/path";
import { BaseCommand, type ICommandContext } from "@exaix/cli/base.ts";
import { EvalSqliteStore, resolveEvalDbPath } from "@exaix/eval-history";
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
  suite_score?: number;
  passed: boolean;
  timestamp: string;
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
    if (fmt === "json") {
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
  }): void {
    const view = options.view ?? "cost";

    if (options.groupBy) {
      const dbPath = resolveEvalDbPath();
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
          `  ${"Name".padEnd(30)} ${"Tasks".padEnd(6)} ${"Passed".padEnd(8)} ${"Mean".padEnd(7)} ${"Delta".padEnd(8)} ${
            "Pass@1".padEnd(8)
          } ${"Reconcile".padEnd(10)} ${"Duration".padEnd(10)}`,
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
      return;
    }
    if (view === "cost") {
      const dbPath = resolveEvalDbPath();
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

    if (view === "families") {
      const dbPath = resolveEvalDbPath();
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
          `  ${"Family".padEnd(25)} ${"Tasks".padEnd(6)} ${"Mean".padEnd(7)} ${"Pass@1".padEnd(8)} ${
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

    console.log(`Unknown report view: ${view}. Supported views: cost, families`);
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

export function buildRunArgs(options: {
  pack?: string[];
  tag?: string[];
  scenario?: string[];
  scoreThreshold?: number;
  trials?: number;
  historyFormat?: string;
  cell?: string;
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

function formatNumberOrAbsent(value: Opt<number, Reason.OptionalInput>, digits = 0): string {
  return value === undefined ? COST_REPORT_ABSENT_VALUE : value.toFixed(digits);
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
  } | ${padRight("PASSED", 8)} | TIMESTAMP`;
  const sep = "-".repeat(header.length);
  console.log(header);
  console.log(sep);

  for (const entry of entries) {
    const score = entry.suite_score !== undefined ? entry.suite_score.toFixed(2) : "N/A";
    const passed = entry.passed ? "✓" : "✗";
    const ts = entry.timestamp.slice(0, 19).replace("T", " ");
    console.log(
      `${padRight(entry.run_id.slice(0, 36), 36)} | ${padRight(entry.scenario_id.slice(0, 28), 28)} | ${
        padRight(entry.outcome.slice(0, 16), 16)
      } | ${padRight(score, 8)} | ${padRight(passed, 8)} | ${ts}`,
    );
  }
}

function padRight(s: string, len: number): string {
  return s.length >= len ? s : s + " ".repeat(len - s.length);
}
