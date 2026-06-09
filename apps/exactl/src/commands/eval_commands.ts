/**
 * @module EvalCommands
 * @path apps/exactl/src/commands/eval_commands.ts
 * @description Provides CLI commands for evaluation runs and history queries.
 * @architectural-layer CLI
 * @related-files [tests/scenario_framework/runner/main.ts, tests/scenario_framework/schema/history_schema.ts]
 */

import { resolve } from "@std/path";
import { BaseCommand, type ICommandContext } from "@exaix/cli/base.ts";

interface IRunManifest {
  scenarioId: string;
  outcome: string;
}

interface IHistoryEntry {
  run_id: string;
  scenario_id: string;
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

    // Always enable eval mode for the CLI
    args.push("--eval-mode");

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
}

function resolveFrameworkPath(): string {
  const envPath = Deno.env.get("EXA_FRAMEWORK_PATH");
  if (envPath) {
    return resolve(envPath, "runner/main.ts");
  }
  return resolve(new URL(".", import.meta.url).pathname, FRAMEWORK_RELATIVE_PATH);
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
