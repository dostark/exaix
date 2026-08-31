/**
 * @module ScenarioFrameworkScoring
 * @path tests/scenario_framework/runner/scoring.ts
 * @description Pure scoring functions for weighted criterion and step
 * evaluation. Added in Phase 100 Step 1.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/schema/step_schema.ts, tests/scenario_framework/tests/unit/scoring_test.ts]
 */

import type { Opt, Reason } from "@exaix/core/types";
import type { ICriterionResult, IScenarioStep } from "../schema/step_schema.ts";
import { CriterionClass, CriterionStatus } from "../schema/step_schema.ts";
import { configurable } from "@exaix/core/config";
import { ConfigValueType } from "@exaix/core";

// Scoring modes

/** The scoring composition mode a scenario runs under. */
export enum ScoringMode {
  /** Weighted mean of step scores; criterion failures only lower their step. */
  ADDITIVE = "additive",
  /** Multiplicative: a `class: security` criterion failure zeroes the whole suite. */
  GATED = "gated",
}

// Exported interfaces

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

// Configurable defaults for eval scoring

/** Default minimum suite score (0.0–1.0) required to pass an eval-mode scenario run. */
export const DEFAULT_EVAL_SCORE_THRESHOLD: number = configurable({
  key: "eval.score_threshold",
  default: 0.5,
  type: ConfigValueType.NUMBER,
  description: "Minimum suite_score (0.0-1.0) required to pass an eval-mode scenario run",
  min: 0.0,
  max: 1.0,
});

/** Default number of sequential trials per scenario in eval mode. */
export const DEFAULT_EVAL_TRIALS: number = configurable({
  key: "eval.trials",
  default: 1,
  type: ConfigValueType.NUMBER,
  description: "Number of sequential trial runs per scenario in eval mode",
  min: 1,
  max: 100,
});

// RunVerdict constants

export const RunVerdict = {
  PASSING: { allPassed: true, infraError: false, scenarios: [] } as IRunVerdict,
  INFRA_ERROR: { allPassed: false, infraError: true, scenarios: [] } as IRunVerdict,
} as const;

// Score-threshold gating functions (used by main.ts for RunVerdict)

/** Whether a suite score meets the threshold (boundary equality counts as passing). */
export function checkScoreThreshold(suiteScore: number, threshold: number): boolean {
  return suiteScore >= threshold;
}

// A threshold may only ever lower a verdict — never lift one whose recorded outcome failed.
// Without this, a run could print a passing suite score while its manifest recorded a
// scenario-failure outcome; the two must independently agree.
export function resolveScenarioVerdict(
  outcome: Opt<string, Reason.OptionalContext>,
  suiteScore: number,
  threshold: Opt<number, Reason.OptionalInput>,
): boolean {
  if (outcome !== "success") return false;
  return threshold === undefined || checkScoreThreshold(suiteScore, threshold);
}

/** `allPassed` is true only when every scenario passed; `infraError` is set separately by the caller. */
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

export function computeStepScore(
  criterionResults: ICriterionResult[],
): number {
  if (criterionResults.length === 0) return 1.0;

  let weightedSum = 0;
  let totalWeight = 0;

  for (const result of criterionResults) {
    if (result.status === CriterionStatus.SKIPPED) continue;
    // ERROR and TIMEOUT unconditionally score 0, regardless of score field
    if (result.status === CriterionStatus.ERROR || result.status === CriterionStatus.TIMEOUT) {
      const weight = result.score_weight ?? DEFAULT_CRITERION_WEIGHT;
      totalWeight += weight;
      continue;
    }

    const weight = result.score_weight ?? DEFAULT_CRITERION_WEIGHT;
    totalWeight += weight;

    const score = result.score !== undefined ? result.score : (result.status === CriterionStatus.PASSED ? 1 : 0);
    weightedSum += score * weight;
  }

  // All-SKIPPED: vacuously passing
  if (totalWeight === 0) return 1.0;
  return weightedSum / totalWeight;
}

// Daemon lifecycle steps get zero weight: counting them turns the suite score into "fraction of
// steps that passed" and rewards a scenario for padding itself with passing start/stop steps.
// Keyed on step behavior (command+args), not on the step id, since id naming isn't enforced.
function defaultStepWeight(step: IStepScoreInput["step"]): number {
  return isDaemonLifecycleStep(step) ? 0 : DEFAULT_STEP_WEIGHT;
}

function isDaemonLifecycleStep(step: IStepScoreInput["step"]): boolean {
  if (step.command !== "daemon") return false;
  return (step.args ?? []).some((arg) => arg === "start" || arg === "stop" || arg === "restart");
}

export function computeSuiteScore(
  stepOutcomes: IStepScoreInput[],
): number {
  if (stepOutcomes.length === 0) return 1.0;

  let weightedSum = 0;
  let totalWeight = 0;

  for (const outcome of stepOutcomes) {
    const weight = outcome.step.step_weight ?? defaultStepWeight(outcome.step);
    totalWeight += weight;
    weightedSum += outcome.score * weight;
  }

  if (totalWeight === 0) return 0.0;
  return weightedSum / totalWeight;
}

// Multiplies suiteScore by a gate that is 0 exactly when ANY `class: security` criterion FAILED
// (matching Harness-Bench's Security·Completion·Process semantics); an identity otherwise, so
// the additive default stays byte-identical for scenarios with no security criteria.
export function composeGated(
  suiteScore: number,
  criterionResults: ICriterionResult[],
): number {
  const securityViolation = criterionResults.some(
    (result) => result.class === CriterionClass.SECURITY && result.status === CriterionStatus.FAILED,
  );
  return securityViolation ? 0 : suiteScore;
}

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
