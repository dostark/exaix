/**
 * @module EvalCommandDocs
 * @path apps/exactl/src/command_docs/eval_docs.ts
 * @description The doc records of the exactl eval noun and its leaves.
 * @architectural-layer CLI
 * @dependencies [@exaix/cli]
 * @related-files [apps/exactl/src/command_builders/eval_command.ts, apps/exactl/src/command_docs/mod.ts]
 */

import { ExaCtlExitCode, ExaCtlOutputKind, type IExaCtlCommandDoc } from "@exaix/cli";
import { ExaCtlCommandName, ExaCtlSubNoun, ExaCtlVerb } from "../exactl_constants.ts";
import { ExaCtlCommandGroup, type IExaCtlNounDoc } from "../docs/exactl_noun_doc.ts";
import { exactlCommand } from "./doc_helpers.ts";

const EVAL = ExaCtlCommandName.EVAL;
const CALIBRATION = ExaCtlSubNoun.CALIBRATION;

export const EVAL_NOUN_DOC: IExaCtlNounDoc = {
  noun: EVAL,
  group: ExaCtlCommandGroup.OPERATIONS,
  summary: "Run evaluation scenarios and read their history",
  description:
    "Evaluation scenarios run an agent against a fixed task and score the result. The history keeps every run, and the report compares cells by score, cost and failure class.",
  lifecycle: [],
};

export const EVAL_DOCS: readonly IExaCtlCommandDoc[] = [
  {
    path: [EVAL, ExaCtlVerb.RUN],
    summary: "Run evaluation scenarios",
    description:
      "Runs the selected scenarios in the scenario framework and records each run in the history. With `-o jsonl` it prints one event when the run starts and one when it ends, and the scenario output goes to stderr.",
    examples: [
      { title: "Run one pack", command: "exactl eval run --pack eval-smoke" },
      { title: "Run one scenario", command: "exactl eval run --scenario read-file-roundtrip --trials 3" },
    ],
    seeAlso: [
      exactlCommand(...[EVAL, ExaCtlVerb.HISTORY]),
      exactlCommand(...[EVAL, ExaCtlVerb.REPORT]),
    ],
    exitCodes: [ExaCtlExitCode.FAILURE],
    output: ExaCtlOutputKind.STREAM,
  },
  {
    path: [EVAL, ExaCtlVerb.HISTORY],
    summary: "Query the evaluation history",
    description:
      "Lists the recorded runs, oldest first, filtered by scenario, pack or date. Use `-n` to keep the last rows.",
    examples: [
      { title: "Show the last runs", command: "exactl eval history --limit 10" },
      { title: "Filter by pack", command: "exactl eval history --pack eval-smoke -o json" },
    ],
    seeAlso: [
      exactlCommand(...[EVAL, ExaCtlVerb.COMPARE]),
      exactlCommand(...[EVAL, ExaCtlVerb.REPORT]),
    ],
    exitCodes: [ExaCtlExitCode.FAILURE],
    output: ExaCtlOutputKind.COLLECTION,
  },
  {
    path: [EVAL, ExaCtlVerb.COMPARE],
    summary: "Compare two evaluation runs",
    description: "Prints the score and step differences between two recorded runs.",
    examples: [
      { title: "Compare two runs", command: "exactl eval compare --run-a run-1 --run-b run-2" },
    ],
    seeAlso: [
      exactlCommand(...[EVAL, ExaCtlVerb.HISTORY]),
    ],
    exitCodes: [ExaCtlExitCode.FAILURE],
    output: ExaCtlOutputKind.ITEM,
  },
  {
    path: [EVAL, ExaCtlVerb.REPORT],
    summary: "Print an evaluation report view",
    description:
      "Prints one report view as text: cost, families, lift, ablation, frontier, failures, external, robustness, interactive or memory. The frontier, failures and external views also print JSON with `-o json`.",
    examples: [
      { title: "Show the cost view", command: "exactl eval report --view cost" },
      { title: "Show the frontier as JSON", command: "exactl eval report --view frontier -o json" },
    ],
    seeAlso: [
      exactlCommand(...[EVAL, ExaCtlVerb.HISTORY]),
    ],
    exitCodes: [ExaCtlExitCode.FAILURE],
    output: ExaCtlOutputKind.PROTOCOL,
  },
  {
    path: [EVAL, CALIBRATION, ExaCtlVerb.GENERATE],
    summary: "Capture judge calls for calibration",
    description:
      "Runs real scenarios and writes the judge calls to a directory, so that `eval calibration score` can compare a judge with a reference.",
    examples: [
      {
        title: "Capture the evidence",
        command: "exactl eval calibration generate --pack eval-smoke --capture-calibration-evidence evidence",
      },
    ],
    seeAlso: [
      exactlCommand(...[EVAL, CALIBRATION, ExaCtlVerb.SCORE]),
    ],
    exitCodes: [ExaCtlExitCode.FAILURE],
    output: ExaCtlOutputKind.STREAM,
  },
  {
    path: [EVAL, CALIBRATION, ExaCtlVerb.SCORE],
    summary: "Score judge agreement over captured evidence",
    description: "Scores how well a judge agrees with a reference evaluator over the captured calibration evidence.",
    examples: [
      {
        title: "Score a judge",
        command:
          "exactl eval calibration score --capture-dir evidence --target claude-cli:claude-sonnet-5 --reference codex-cli:gpt-5.6-sol --seed 1",
      },
    ],
    seeAlso: [
      exactlCommand(...[EVAL, CALIBRATION, ExaCtlVerb.GENERATE]),
    ],
    exitCodes: [ExaCtlExitCode.FAILURE],
    output: ExaCtlOutputKind.PROTOCOL,
  },
];
