/**
 * @module EvalCommands
 * @path apps/exactl/src/commands/eval_commands.ts
 * @description Provides CLI commands for evaluation runs and history queries.
 * @architectural-layer CLI
 * @related-files [tests/scenario_framework/runner/main.ts, tests/scenario_framework/schema/history_schema.ts]
 */

import { resolve } from "@std/path";
import { BaseCommand, type ICommandContext } from "@exaix/cli/base.ts";
import { EvalSqliteStore } from "../../../../tests/scenario_framework/runner/history_sqlite.ts";

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

const FRAMEWORK_RELATIVE_PATH = "../../../tests/scenario_framework/runner/main.ts";

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
  }): Promise<void> {
    const historyDir = resolve(Deno.cwd(), "tests", "scenario_framework", "output", "history");

    // Read global history file
    const historyFile = resolve(historyDir, "eval-history.jsonl");
    let lines: string[] = [];
    try {
      const content = await Deno.readTextFile(historyFile);
      lines = content.trim().split("\n").filter(Boolean);
    } catch {
      console.log("No evaluation history found.");
      return;
    }

    // Parse entries
    const entries: IHistoryEntry[] = lines.map((line) => JSON.parse(line));

    // Apply filters
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

    if (filtered.length === 0) {
      console.log("No matching history entries found.");
      return;
    }

    const fmt = options.format ?? "table";
    if (fmt === "json") {
      console.log(JSON.stringify(filtered, null, 2));
    } else {
      renderHistoryTable(filtered);
    }
  }

  compare(runA: string, runB: string): void {
    const dbPath = resolve(Deno.cwd(), ".exa", "eval.db");
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

  args.push("--eval-mode");

  return args;
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
