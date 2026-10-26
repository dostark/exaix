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

import { computeHarnessLift } from "../tests/scenario_framework/runner/harness_lift.ts";
import { runOutcomeReport } from "./outcome_report_runner.ts";

runOutcomeReport("run_harness_lift_report.ts", computeHarnessLift);
