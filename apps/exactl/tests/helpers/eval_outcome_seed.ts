/**
 * @module EvalOutcomeSeedTestHelper
 * @path apps/exactl/tests/helpers/eval_outcome_seed.ts
 * @description Writes one successful eval run with a verify-tests step score, as the lift and ablation report tests seed their history.
 * @architectural-layer CLI
 * @related-files [apps/exactl/tests/eval_report_lift_view_test.ts, apps/exactl/tests/eval_report_ablation_view_test.ts]
 */

import { EvalScoringMode } from "@exaix/core";
import type { EvalSqliteStore } from "@exaix/eval-history";
import { VERIFY_TESTS_STEP_ID } from "../../../../tests/scenario_framework/runner/scenario_templates.ts";

interface IOutcomeRunSeed {
  runId: string;
  scenarioId: string;
  cellId: string;
  provider: string;
  model: string;
  score: number;
  tags?: string[];
}

/** Writes a passed `swe_tasks` run whose verify-tests step carries the same score as the suite. */
export function seedOutcomeRun(store: EvalSqliteStore, overrides: IOutcomeRunSeed): void {
  store.writeRun({
    run_id: overrides.runId,
    scenario_id: overrides.scenarioId,
    pack: "swe_tasks",
    tags: overrides.tags ?? ["task:bug-fix"],
    outcome: "success",
    mode: "auto",
    scoring_mode: EvalScoringMode.ADDITIVE,
    suite_score: overrides.score,
    passed: true,
    timestamp: new Date().toISOString(),
    cell_id: overrides.cellId,
    provider: overrides.provider,
    model: overrides.model,
  }, [{ stepId: VERIFY_TESTS_STEP_ID, score: overrides.score }]);
}
