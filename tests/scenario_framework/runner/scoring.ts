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

export interface IMultiTrialMetrics {
  mean: number;
  min: number;
  max: number;
  stdev: number;
  pass_at_1: number;
  pass_k: number;
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

/**
 * Computes multi-trial metrics from an array of trial scores.
 * Pure function — no side effects.
 */
export function computeMultiTrialMetrics(
  trialScores: number[],
  scoreThreshold: number = 0.5,
): IMultiTrialMetrics {
  if (trialScores.length === 0) {
    return { mean: 0, min: 0, max: 0, stdev: 0, pass_at_1: 0, pass_k: 0 };
  }

  const n = trialScores.length;
  const mean = trialScores.reduce((a, b) => a + b, 0) / n;
  const min = Math.min(...trialScores);
  const max = Math.max(...trialScores);

  const variance = trialScores.reduce((sum, s) => sum + (s - mean) ** 2, 0) / n;
  const stdev = Math.sqrt(variance);

  const passCount = trialScores.filter((s) => s >= scoreThreshold).length;
  const pass_at_1 = passCount / n;

  let pass_k = 0;
  for (const score of trialScores) {
    if (score >= scoreThreshold) {
      pass_k++;
    } else {
      break;
    }
  }

  return { mean, min, max, stdev, pass_at_1, pass_k };
}
