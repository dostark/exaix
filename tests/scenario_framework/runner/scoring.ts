/**
 * @module ScenarioFrameworkScoring
 * @path tests/scenario_framework/runner/scoring.ts
 * @description Pure scoring functions for weighted criterion and step
 * evaluation. Added in Phase 100 Step 1.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/schema/step_schema.ts, tests/scenario_framework/tests/unit/scoring_test.ts]
 */

import type { ICriterionResult, IScenarioStep } from "../schema/step_schema.ts";
import { CriterionStatus } from "../schema/step_schema.ts";

export interface IStepScoreInput {
  stepId: string;
  score: number;
  step: IScenarioStep;
}

const DEFAULT_CRITERION_WEIGHT = 1.0;
const DEFAULT_STEP_WEIGHT = 1.0;

/**
 * Computes a step score (0.0–1.0) from criterion results.
 * Each criterion's score_weight controls its contribution.
 * When no criteria exist, returns 1.0 (pass).
 * When no weights are set, all criteria weigh equally.
 */
export function computeStepScore(
  criterionResults: ICriterionResult[],
): number {
  if (criterionResults.length === 0) return 1.0;

  let weightedSum = 0;
  let totalWeight = 0;

  for (const result of criterionResults) {
    const weight = result.score_weight ?? DEFAULT_CRITERION_WEIGHT;
    totalWeight += weight;
    if (result.status === CriterionStatus.PASSED) {
      weightedSum += weight;
    }
  }

  if (totalWeight === 0) return 0.0;
  return weightedSum / totalWeight;
}

/**
 * Computes a suite score (0.0–1.0) from step outcomes.
 * Each step's step_weight controls its contribution.
 * When no weights are set, all steps weigh equally.
 */
export function computeSuiteScore(
  stepOutcomes: IStepScoreInput[],
): number {
  if (stepOutcomes.length === 0) return 1.0;

  let weightedSum = 0;
  let totalWeight = 0;

  for (const outcome of stepOutcomes) {
    const weight = outcome.step.step_weight ?? DEFAULT_STEP_WEIGHT;
    totalWeight += weight;
    weightedSum += outcome.score * weight;
  }

  if (totalWeight === 0) return 0.0;
  return weightedSum / totalWeight;
}
