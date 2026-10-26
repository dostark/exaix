#!/usr/bin/env -S deno run -A
/**
 * @module OutcomeReportRunner
 * @path scripts/outcome_report_runner.ts
 * @description Reads outcome runs from eval-history, hands them to a report function, and prints the report as JSON.
 * @architectural-layer Script
 * @dependencies [@exaix/eval-history]
 * @related-files [scripts/run_ablation_report.ts, scripts/run_harness_lift_report.ts]
 * Usage: imported by run_ablation_report.ts and run_harness_lift_report.ts; not a standalone command.
 */

import { EvalSqliteStore, type IOutcomeRunRow } from "@exaix/eval-history";
import { VERIFY_TESTS_STEP_ID } from "../tests/scenario_framework/runner/scenario_templates.ts";

interface IOutcomeReportArgs {
  db: string;
  scenario?: string;
  pack?: string;
}

function parseArgs(argv: string[]): IOutcomeReportArgs {
  const args: IOutcomeReportArgs = { db: "" };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === "--db" && value !== undefined) {
      args.db = value;
      i++;
    } else if (flag === "--scenario" && value !== undefined) {
      args.scenario = value;
      i++;
    } else if (flag === "--pack" && value !== undefined) {
      args.pack = value;
      i++;
    }
  }
  return args;
}

/** Parses the process arguments, queries the verify-tests outcome runs, and prints `computeReport(rows)`. */
export function runOutcomeReport(scriptName: string, computeReport: (rows: IOutcomeRunRow[]) => unknown): void {
  const args = parseArgs(Deno.args);
  if (!args.db) {
    console.error(
      `Usage: deno run -A scripts/${scriptName} --db <eval.db> [--scenario <id>] [--pack <name>]`,
    );
    Deno.exit(1);
  }

  const store = new EvalSqliteStore(args.db);
  try {
    store.initialize();
    const rows = store.queryOutcomeRuns({
      scenario: args.scenario,
      pack: args.pack,
      outcomeStepIds: [VERIFY_TESTS_STEP_ID],
    });
    console.log(JSON.stringify(computeReport(rows)));
  } finally {
    store.close();
  }
}
