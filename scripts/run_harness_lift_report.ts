#!/usr/bin/env -S deno run -A
/**
 * @module RunHarnessLiftReport
 * @path scripts/run_harness_lift_report.ts
 * @description Computes the Phase 143 Step 1 harness-lift report (bare-delegate baseline vs full
 *   Exaix cell, paired by task family) from eval-history and prints it as JSON on stdout.
 *   Bridges the `apps/exactl` CLI (which must not import the Test layer) to the lift engine in
 *   `tests/scenario_framework/runner/harness_lift.ts`.
 * @architectural-layer Script
 * @related-files [tests/scenario_framework/runner/harness_lift.ts, packages/eval-history/src/history_sqlite.ts, apps/exactl/src/commands/eval_commands.ts]
 *
 * Usage:
 *   deno run -A scripts/run_harness_lift_report.ts --db <eval.db> [--scenario <id>] [--pack <name>]
 */

import { EvalSqliteStore } from "@exaix/eval-history";
import { computeHarnessLift } from "../tests/scenario_framework/runner/harness_lift.ts";
import { VERIFY_TESTS_STEP_ID } from "../tests/scenario_framework/runner/scenario_templates.ts";

function parseArgs(argv: string[]): { db: string; scenario?: string; pack?: string } {
  const args: { db: string; scenario?: string; pack?: string } = { db: "" };
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

const args = parseArgs(Deno.args);
if (!args.db) {
  console.error(
    "Usage: deno run -A scripts/run_harness_lift_report.ts --db <eval.db> [--scenario <id>] [--pack <name>]",
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
  const report = computeHarnessLift(rows);
  console.log(JSON.stringify(report));
} finally {
  store.close();
}
