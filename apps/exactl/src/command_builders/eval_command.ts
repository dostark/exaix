/**
 * @module ExaCtlEvalCommand
 * @path apps/exactl/src/command_builders/eval_command.ts
 * @description Builds the exactl eval command tree from the shared runtime services.
 * @architectural-layer CLI
 * @related-files [apps/exactl/src/exactl.ts, apps/exactl/src/exactl_runtime.ts]
 */

import { Command } from "@cliffy/command";
import type { IExaCtlRuntime } from "../exactl_runtime.ts";
import { CLI_OUTPUT_FORMAT_OPTION } from "../exactl_constants.ts";

function createEvalCommand(runtime: IExaCtlRuntime) {
  const command = new Command()
    .description("Run evaluations and query evaluation history");
  for (
    const [name, child] of [...addEvalCommands1(runtime), ...addEvalCommands2(runtime), ...addEvalCommands3(runtime)]
  ) command.command(name, child);
  return command;
}

function addEvalCommands1(runtime: IExaCtlRuntime) {
  const { evalCommands } = runtime;
  return [
    [
      "run",
      new Command()
        .description("Run evaluation scenarios")
        .option("-P, --pack <pack:string>", "Run scenarios in a named pack (repeatable)", { collect: true })
        .option("-t, --tag <tag:string>", "Filter by tag (repeatable)", { collect: true })
        .option("-s, --scenario <id:string>", "Run a single named scenario (repeatable)", { collect: true })
        .option("--score-threshold <threshold:number>", "Minimum suite score to pass", { default: 0.5 })
        .option("--trials <n:number>", "Number of trials per scenario", { default: 1 })
        .option("--history-format <format:string>", "History storage: sqlite+jsonl or jsonl", {
          default: "sqlite+jsonl",
        })
        .option(
          "--cell <tool:string>",
          "Run only the matrix cell whose tool matches (e.g. claude-code, opencode) — every other cell is skipped, not run",
        )
        .option(
          "--max-cost-usd <usd:number>",
          "Stop scheduling after accumulated tracked cost reaches this cap (skips remaining scenarios; never truncates a running task)",
        )
        .option("-v, --verbose", "Show detailed output")
        .action(async (options) => {
          try {
            await evalCommands.run({
              pack: options.pack,
              tag: options.tag,
              scenario: options.scenario,
              scoreThreshold: options.scoreThreshold,
              trials: options.trials,
              historyFormat: options.historyFormat,
              cell: options.cell,
              maxCostUsd: options.maxCostUsd,
              verbose: options.verbose,
            });
          } catch (error) {
            console.error("eval run failed:", error instanceof Error ? error.message : String(error));
            Deno.exit(1);
          }
        }),
    ],
    [
      "history",
      new Command()
        .description("Query evaluation history")
        .option("-l, --last <n:number>", "Show last N entries")
        .option("--scenario <id:string>", "Filter by scenario ID")
        .option("--pack <name:string>", "Filter by pack name")
        .option("--since <date:string>", "Filter to runs since date (ISO 8601)")
        .option(CLI_OUTPUT_FORMAT_OPTION, "Output format: table, json", { default: "table" })
        .action(async (options) => {
          try {
            await evalCommands.history({
              last: options.last,
              scenario: options.scenario,
              pack: options.pack,
              since: options.since,
              format: options.format,
            });
          } catch (error) {
            console.error("eval history failed:", error instanceof Error ? error.message : String(error));
            Deno.exit(1);
          }
        }),
    ],
  ] as const;
}

function addEvalCommands2(runtime: IExaCtlRuntime) {
  const { evalCommands } = runtime;
  return [
    [
      "compare",
      new Command()
        .description("Compare two evaluation runs side-by-side")
        .option("--run-a <id:string>", "First run ID to compare", { required: true })
        .option("--run-b <id:string>", "Second run ID to compare", { required: true })
        .action((options) => {
          try {
            evalCommands.compare(options.runA, options.runB);
          } catch (error) {
            console.error("eval compare failed:", error instanceof Error ? error.message : String(error));
            Deno.exit(1);
          }
        }),
    ],
    [
      "report",
      new Command()
        .description("Render a cross-cell timing/token/tracked-cost comparison report")
        .option(
          "--view <view:string>",
          "Report view: cost, families, lift, ablation, frontier, failures, external, robustness, interactive, or memory",
          { default: "cost" },
        )
        .option("--scenario <id:string>", "Filter to a single scenario ID")
        .option("--pack <pack:string>", "Filter to a single pack (e.g. swe-tasks)")
        .option("-l, --last <n:number>", "Limit to the last N runs")
        .option("--group-by <prefix:string>", "Group by tag prefix: subsystem or entity")
        .option(CLI_OUTPUT_FORMAT_OPTION, "Output format: table, json (frontier/failures/external views)")
        .option(
          "--run-ids <ids:string>",
          "robustness/interactive views only: comma-separated run IDs to scope the table to " +
            "(regenerates a founding table exactly, regardless of later local runs)",
        )
        .action((options) => {
          try {
            evalCommands.report({
              view: options.view,
              scenario: options.scenario,
              last: options.last,
              pack: options.pack,
              groupBy: options.groupBy,
              format: options.format,
              runIds: options.runIds ? options.runIds.split(",").map((id: string) => id.trim()) : undefined,
            });
          } catch (error) {
            console.error("eval report failed:", error instanceof Error ? error.message : String(error));
            Deno.exit(1);
          }
        }),
    ],
  ] as const;
}

function addEvalCommands3(runtime: IExaCtlRuntime) {
  const { evalCommands } = runtime;
  return [
    [
      "calibration",
      new Command()
        .description("Judge calibration: accumulate real evidence and score judge/reference agreement")
        .command(
          "generate",
          new Command()
            .description("Run real scenarios, capturing real judge-call evidence for calibration")
            .option("-P, --pack <pack:string>", "Run scenarios in a named pack (repeatable)", { collect: true })
            .option("-t, --tag <tag:string>", "Filter by tag (repeatable)", { collect: true })
            .option("-s, --scenario <id:string>", "Run a single named scenario (repeatable)", { collect: true })
            .option(
              "--cell <tool:string>",
              "Run only the matrix cell whose tool matches (e.g. claude-code, opencode)",
            )
            .option("--max-cost-usd <usd:number>", "Stop scheduling after accumulated tracked cost reaches this cap")
            .option("-v, --verbose", "Show detailed output")
            .option(
              "--capture-calibration-evidence <dir:string>",
              "Directory to capture real judge-call evidence into",
              { required: true },
            )
            .action(async (options) => {
              try {
                await evalCommands.calibrationGenerate({
                  pack: options.pack,
                  tag: options.tag,
                  scenario: options.scenario,
                  cell: options.cell,
                  maxCostUsd: options.maxCostUsd,
                  verbose: options.verbose,
                  captureCalibrationEvidence: options.captureCalibrationEvidence,
                });
              } catch (error) {
                console.error(
                  "eval calibration generate failed:",
                  error instanceof Error ? error.message : String(error),
                );
                Deno.exit(1);
              }
            }),
        )
        .command(
          "score",
          new Command()
            .description("Score judge/reference agreement over captured calibration evidence")
            .option("--capture-dir <dir:string>", "Directory captured by 'eval calibration generate'", {
              required: true,
            })
            .option("--target <target:string>", "Target judge, as provider:model (e.g. claude-cli:claude-sonnet-5)", {
              required: true,
            })
            .option(
              "--reference <reference:string>",
              "Reference evaluator, as provider:model (e.g. codex-cli:gpt-5.6-sol)",
              { required: true },
            )
            .option("--seed <seed:string>", "Deterministic selection seed", { required: true })
            .option("--sample-count <n:number>", "Number of eligible artifacts to score")
            .option("--label-threshold <n:number>", "Pass/fail label threshold (0-1)")
            .option("--isolated", "Run the reference evaluator in the bwrap-sandboxed isolation profile")
            .option("--output <dir:string>", "Directory to write the calibration report into")
            .action(async (options) => {
              try {
                await evalCommands.calibrationScore({
                  captureDir: options.captureDir,
                  target: options.target,
                  reference: options.reference,
                  seed: options.seed,
                  sampleCount: options.sampleCount,
                  labelThreshold: options.labelThreshold,
                  isolated: options.isolated,
                  output: options.output,
                });
              } catch (error) {
                console.error("eval calibration score failed:", error instanceof Error ? error.message : String(error));
                Deno.exit(1);
              }
            }),
        ),
    ],
  ] as const;
}

export function buildEvalCommand(runtime: IExaCtlRuntime): ReturnType<typeof createEvalCommand> {
  return createEvalCommand(runtime);
}
