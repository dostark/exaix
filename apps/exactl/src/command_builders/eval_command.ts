/**
 * @module ExaCtlEvalCommand
 * @path apps/exactl/src/command_builders/eval_command.ts
 * @description Builds the exactl eval command tree from the shared runtime services and prints each result through the output renderer.
 * @architectural-layer CLI
 * @related-files [apps/exactl/src/exactl.ts, apps/exactl/src/exactl_runtime.ts, apps/exactl/src/command_docs/eval_docs.ts]
 */

import { Command } from "@cliffy/command";
import { ExaCtlOutputFormat } from "@exaix/cli";
import { ExaCtlError } from "@exaix/cli/errors/exactl_errors.ts";
import type { IExaCtlRuntime } from "../exactl_runtime.ts";
import { ExaCtlCommandName, ExaCtlSubNoun, ExaCtlVerb } from "../exactl_constants.ts";
import { actionOutput } from "../output/exactl_output.ts";
import { documentedNoun } from "../docs/exactl_noun_doc.ts";
import { nounDocFor } from "../command_docs/mod.ts";
import { failCommand } from "./command_failure.ts";
import { documentLeaves } from "./documented_children.ts";

const JSON_VIEW_FORMAT = "json";
const TABLE_VIEW_FORMAT = "table";
const RUN_STARTED_EVENT = "eval.run.started";
const RUN_FINISHED_EVENT = "eval.run.finished";
const SUCCESS_EXIT_CODE = 0;
const HISTORY_ACTION = "eval history";
const EMPTY_HISTORY_JSON = "[]";
const OPTION_SCENARIO = "--scenario <id:string>";
const OPTION_PACK_NAME = "--pack <name:string>";

type TRenderer = ReturnType<typeof actionOutput>["renderer"];

/** Runs one eval action and prints what it collected. */
type TPerform = <T extends object | void>(
  action: string,
  options: T,
  verbDefault: ExaCtlOutputFormat,
  work: (renderer: TRenderer) => Promise<void> | void,
) => Promise<void>;

function isJson(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

/** The runner of one eval action. It writes the collected lines through the renderer and reports a failure. */
function createPerform(runtime: IExaCtlRuntime): TPerform {
  const { display, evalCommands } = runtime;
  /** A machine format keeps stdout to JSON, so a message without data goes to the display. */
  const flushLines = async (renderer: TRenderer, action: string): Promise<void> => {
    const lines = evalCommands.takeOutput();
    if (renderer.machine && lines.length > 0 && !isJson(lines.join("\n"))) {
      display.info("cli.eval", action, { message: lines.join(" ") });
      if (action === HISTORY_ACTION) await renderer.text(EMPTY_HISTORY_JSON);
      return;
    }
    for (const line of lines) await renderer.text(line);
  };
  return async (action, options, verbDefault, work) => {
    const { renderer } = actionOutput(runtime, options, verbDefault);
    try {
      await work(renderer);
      await flushLines(renderer, action);
    } catch (error) {
      if (error instanceof ExaCtlError) throw error;
      failCommand(error as Error);
    }
  };
}

function createRunCommand(runtime: IExaCtlRuntime, perform: TPerform) {
  const { evalCommands } = runtime;
  return new Command()
    .option("-P, --pack <pack:string>", "Run scenarios in a named pack (repeatable)", { collect: true })
    .option("--tag <tag:string>", "Filter by tag (repeatable)", { collect: true })
    .option(OPTION_SCENARIO, "Run a single named scenario (repeatable)", { collect: true })
    .option(
      "--cell <tool:string>",
      "Run only the matrix cell whose tool matches (e.g. claude-code, opencode) — every other cell is skipped, not run",
    )
    .option(
      "--max-cost-usd <usd:number>",
      "Stop scheduling after accumulated tracked cost reaches this cap (skips remaining scenarios; never truncates a running task)",
    )
    .option("-v, --verbose", "Show detailed output")
    .option("--score-threshold <threshold:number>", "Minimum suite score to pass", { default: 0.5 })
    .option("--trials <n:number>", "Number of trials per scenario", { default: 1 })
    .option("--history-store <store:string>", "History storage: sqlite+jsonl or jsonl", { default: "sqlite+jsonl" })
    .action((options) =>
      perform("eval run", options, ExaCtlOutputFormat.TEXT, async (renderer) => {
        if (renderer.machine) await renderer.event({ type: RUN_STARTED_EVENT });
        await evalCommands.run({
          pack: options.pack,
          tag: options.tag,
          scenario: options.scenario,
          cell: options.cell,
          maxCostUsd: options.maxCostUsd,
          verbose: options.verbose,
          scoreThreshold: options.scoreThreshold,
          trials: options.trials,
          historyFormat: options.historyStore,
          childOutputToStderr: renderer.machine,
        });
        if (renderer.machine) await renderer.event({ type: RUN_FINISHED_EVENT, exit_code: SUCCESS_EXIT_CODE });
      })
    );
}

function createHistoryCommand(runtime: IExaCtlRuntime, perform: TPerform) {
  const { evalCommands } = runtime;
  return new Command()
    .option("-n, --limit <n:number>", "Show last N entries")
    .option(OPTION_SCENARIO, "Filter by scenario ID")
    .option(OPTION_PACK_NAME, "Filter by pack name")
    .option("--since <date:string>", "Filter to runs since date (ISO 8601)")
    .action((options) =>
      perform(HISTORY_ACTION, options, ExaCtlOutputFormat.TABLE, (renderer) =>
        evalCommands.history({
          last: options.limit,
          scenario: options.scenario,
          pack: options.pack,
          since: options.since,
          format: renderer.machine ? JSON_VIEW_FORMAT : TABLE_VIEW_FORMAT,
        }))
    );
}

function createCompareCommand(runtime: IExaCtlRuntime, perform: TPerform) {
  const { evalCommands } = runtime;
  return new Command()
    .option("--run-a <id:string>", "First run ID to compare", { required: true })
    .option("--run-b <id:string>", "Second run ID to compare", { required: true })
    .action((options) =>
      perform(
        "eval compare",
        options,
        ExaCtlOutputFormat.TEXT,
        (renderer) => evalCommands.compare(options.runA, options.runB, renderer.machine ? JSON_VIEW_FORMAT : undefined),
      )
    );
}

function createReportCommand(runtime: IExaCtlRuntime, perform: TPerform) {
  const { evalCommands } = runtime;
  return new Command()
    .option(
      "--view <view:string>",
      "Report view: cost, families, lift, ablation, frontier, failures, external, robustness, interactive, or memory",
      { default: "cost" },
    )
    .option(OPTION_SCENARIO, "Filter to a single scenario ID")
    .option("--pack <pack:string>", "Filter to a single pack (e.g. swe-tasks)")
    .option("-n, --limit <n:number>", "Limit to the last N runs")
    .option("--group-by <prefix:string>", "Group by tag prefix: subsystem or entity")
    .option(
      "--run-ids <ids:string>",
      "robustness/interactive views only: comma-separated run IDs to scope the table to " +
        "(regenerates a founding table exactly, regardless of later local runs)",
    )
    .action((options) =>
      perform("eval report", options, ExaCtlOutputFormat.TABLE, (renderer) =>
        evalCommands.report({
          view: options.view,
          scenario: options.scenario,
          last: options.limit,
          pack: options.pack,
          groupBy: options.groupBy,
          format: renderer.machine ? JSON_VIEW_FORMAT : undefined,
          runIds: options.runIds ? options.runIds.split(",").map((id: string) => id.trim()) : undefined,
        }))
    );
}

function createGenerateCommand(runtime: IExaCtlRuntime, perform: TPerform) {
  const { evalCommands } = runtime;
  return new Command()
    .option("-P, --pack <pack:string>", "Run scenarios in a named pack (repeatable)", { collect: true })
    .option("--tag <tag:string>", "Filter by tag (repeatable)", { collect: true })
    .option(OPTION_SCENARIO, "Run a single named scenario (repeatable)", { collect: true })
    .option("--cell <tool:string>", "Run only the matrix cell whose tool matches (e.g. claude-code, opencode)")
    .option("--max-cost-usd <usd:number>", "Stop scheduling after accumulated tracked cost reaches this cap")
    .option("-v, --verbose", "Show detailed output")
    .option(
      "--capture-calibration-evidence <dir:string>",
      "Directory to capture real judge-call evidence into",
      { required: true },
    )
    .action((options) =>
      perform(
        "eval calibration generate",
        options,
        ExaCtlOutputFormat.TEXT,
        (renderer) =>
          evalCommands.calibrationGenerate({
            pack: options.pack,
            tag: options.tag,
            scenario: options.scenario,
            cell: options.cell,
            maxCostUsd: options.maxCostUsd,
            verbose: options.verbose,
            captureCalibrationEvidence: options.captureCalibrationEvidence,
            childOutputToStderr: renderer.machine,
          }),
      )
    );
}

function createScoreCommand(runtime: IExaCtlRuntime, perform: TPerform) {
  const { evalCommands } = runtime;
  return new Command()
    .option("--capture-dir <dir:string>", "Directory captured by 'eval calibration generate'", { required: true })
    .option("--target <target:string>", "Target judge, as provider:model (e.g. claude-cli:claude-sonnet-5)", {
      required: true,
    })
    .option("--reference <reference:string>", "Reference evaluator, as provider:model (e.g. codex-cli:gpt-5.6-sol)", {
      required: true,
    })
    .option("--seed <seed:string>", "Deterministic selection seed", { required: true })
    .option("--sample-count <n:number>", "Number of eligible artifacts to score")
    .option("--label-threshold <n:number>", "Pass/fail label threshold (0-1)")
    .option("--isolated", "Run the reference evaluator in the bwrap-sandboxed isolation profile")
    .option("--report-file <dir:string>", "Directory to write the calibration report into")
    .action((options) =>
      perform("eval calibration score", options, ExaCtlOutputFormat.TEXT, () =>
        evalCommands.calibrationScore({
          captureDir: options.captureDir,
          target: options.target,
          reference: options.reference,
          seed: options.seed,
          sampleCount: options.sampleCount,
          labelThreshold: options.labelThreshold,
          isolated: options.isolated,
          output: options.reportFile,
        }))
    );
}

function createEvalCommand(runtime: IExaCtlRuntime) {
  const noun = nounDocFor(ExaCtlCommandName.EVAL);
  const perform = createPerform(runtime);
  const calibration = new Command()
    .command(ExaCtlVerb.GENERATE, createGenerateCommand(runtime, perform))
    .command(ExaCtlVerb.SCORE, createScoreCommand(runtime, perform));
  const command = documentedNoun(new Command(), noun)
    .command(ExaCtlVerb.RUN, createRunCommand(runtime, perform))
    .command(ExaCtlVerb.HISTORY, createHistoryCommand(runtime, perform))
    .command(ExaCtlVerb.COMPARE, createCompareCommand(runtime, perform))
    .command(ExaCtlVerb.REPORT, createReportCommand(runtime, perform))
    .command(ExaCtlSubNoun.CALIBRATION, calibration);
  documentLeaves(command, [ExaCtlCommandName.EVAL], noun.lifecycle);
  documentLeaves(calibration, [ExaCtlCommandName.EVAL, ExaCtlSubNoun.CALIBRATION], noun.lifecycle);
  return command;
}

export function buildEvalCommand(runtime: IExaCtlRuntime): ReturnType<typeof createEvalCommand> {
  return createEvalCommand(runtime);
}
