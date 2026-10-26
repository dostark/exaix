#!/usr/bin/env -S deno run -A
/**
 * @module RunAblationReport
 * @path scripts/run_ablation_report.ts
 * @description Computes the Phase 143 Step 2 feature-ablation report (full-config cell vs
 *   each `ablate-<subsystem>` cell, paired by task family per subsystem arm) from
 *   eval-history and prints it as JSON on stdout. Bridges the `apps/exactl` CLI (which must
 *   not import the Test layer) to the contribution engine in
 *   `tests/scenario_framework/runner/ablation_lift.ts`.
 * @architectural-layer Script
 * @related-files [tests/scenario_framework/runner/ablation_lift.ts, packages/eval-history/src/history_sqlite.ts, apps/exactl/src/commands/eval_commands.ts]
 *
 * Usage:
 *   deno run -A scripts/run_ablation_report.ts --db <eval.db> [--scenario <id>] [--pack <name>]
 */

import { computeAblationContributions } from "../tests/scenario_framework/runner/ablation_lift.ts";
import { runOutcomeReport } from "./outcome_report_runner.ts";

runOutcomeReport("run_ablation_report.ts", computeAblationContributions);
