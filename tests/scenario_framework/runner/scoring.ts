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
import { configurable } from "@exaix/core/config";
import { ConfigValueType } from "@exaix/core";

// ============================================================================
// Exported interfaces
// ============================================================================

export interface IScenarioVerdict {
  scenarioId: string;
  pack: string;
  suiteScore: number;
  passed: boolean;
}

export interface IRunVerdict {
  allPassed: boolean;
  infraError: boolean;
  scenarios: IScenarioVerdict[];
}

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
  pass_pow_k: number;
}

// ============================================================================
// Configurable defaults for eval scoring
// ============================================================================

/**
 * Default minimum suite score (0.0–1.0) required to pass an eval-mode scenario
 * run. Configurable via config DB key `eval.score_threshold`.
 */
export const DEFAULT_EVAL_SCORE_THRESHOLD: number = configurable({
  key: "eval.score_threshold",
  default: 0.5,
  type: ConfigValueType.NUMBER,
  description: "Minimum suite_score (0.0-1.0) required to pass an eval-mode scenario run",
  min: 0.0,
  max: 1.0,
});

/**
 * Default number of sequential trials per scenario in eval mode.
 * Configurable via config DB key `eval.trials`.
 */
export const DEFAULT_EVAL_TRIALS: number = configurable({
  key: "eval.trials",
  default: 1,
  type: ConfigValueType.NUMBER,
  description: "Number of sequential trial runs per scenario in eval mode",
  min: 1,
  max: 100,
});

// ============================================================================
// RunVerdict constants
// ============================================================================

export const RunVerdict = {
  PASSING: { allPassed: true, infraError: false, scenarios: [] } as IRunVerdict,
  INFRA_ERROR: { allPassed: false, infraError: true, scenarios: [] } as IRunVerdict,
} as const;

// ============================================================================
// Score-threshold gating functions (used by main.ts for RunVerdict)
// ============================================================================

/**
 * Determines whether a single suite score meets the threshold.
 * Boundary equality (score === threshold) counts as passing.
 */
export function checkScoreThreshold(suiteScore: number, threshold: number): boolean {
  return suiteScore >= threshold;
}

/**
 * Accumulates an array of per-scenario verdicts into a run-level verdict.
 * `allPassed` is true only when every scenario passed; `infraError` is set
 * separately by the caller when an infrastructure failure occurred.
 */
export function accumulateRunVerdict(scenarios: IScenarioVerdict[]): IRunVerdict {
  if (scenarios.length === 0) {
    return { ...RunVerdict.PASSING, scenarios: [] };
  }
  return {
    allPassed: scenarios.every((s) => s.passed),
    infraError: false,
    scenarios,
  };
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
    return { mean: 0, min: 0, max: 0, stdev: 0, pass_at_1: 0, pass_pow_k: 0 };
  }

  const n = trialScores.length;
  const mean = trialScores.reduce((a, b) => a + b, 0) / n;
  const min = Math.min(...trialScores);
  const max = Math.max(...trialScores);

  const variance = trialScores.reduce((sum, s) => sum + (s - mean) ** 2, 0) / n;
  const stdev = Math.sqrt(variance);

  const passCount = trialScores.filter((s) => s >= scoreThreshold).length;
  const pass_at_1 = passCount / n;
  const pass_pow_k = n > 0 ? Math.pow(pass_at_1, n) : 0;

  return { mean, min, max, stdev, pass_at_1, pass_pow_k };
}
