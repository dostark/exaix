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

/** The scoring composition mode a scenario runs under (Phase 143 Step 3). */
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

// RunVerdict constants

export const RunVerdict = {
  PASSING: { allPassed: true, infraError: false, scenarios: [] } as IRunVerdict,
  INFRA_ERROR: { allPassed: false, infraError: true, scenarios: [] } as IRunVerdict,
} as const;

// Score-threshold gating functions (used by main.ts for RunVerdict)

/**
 * Determines whether a single suite score meets the threshold.
 * Boundary equality (score === threshold) counts as passing.
 */
export function checkScoreThreshold(suiteScore: number, threshold: number): boolean {
  return suiteScore >= threshold;
}

/**
 * Resolves a scenario's pass/fail verdict from BOTH its recorded outcome and its
 * suite score. A threshold may only ever lower a verdict — it can never lift a
 * scenario whose steps failed.
 *
 * Phase 150 LIVE-RT: the first live delegate run printed ✅ PASSED at 0.727 while
 * its manifest recorded `scenario-failure` — three outcome assertions had failed,
 * but the verdict was taken from the weighted score alone and the outcome was
 * ignored. That is precisely the green-but-hollow pass this phase exists to make
 * impossible, one level above the delegate.
 *
 * @param outcome Manifest outcome (`"success"` when every step passed); `undefined`
 *   when no manifest was produced, which never passes.
 * @param threshold Score gate; when `undefined` the outcome alone decides.
 */
export function resolveScenarioVerdict(
  outcome: Opt<string, Reason.OptionalContext>,
  suiteScore: number,
  threshold: Opt<number, Reason.OptionalInput>,
): boolean {
  if (outcome !== "success") return false;
  return threshold === undefined || checkScoreThreshold(suiteScore, threshold);
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

/**
 * Weight a step contributes when it declares none.
 *
 * Daemon lifecycle carries **zero**: starting or stopping a daemon passing says nothing about the
 * behaviour under test, and counting it made the suite score really "the fraction of steps that
 * passed". Measured in Step 17: a mutation that dropped *every* pinned skill still scored 0.800,
 * above the 0.7 gate this phase installs, so the gate would have stayed green over a completely
 * dead subsystem. It also created a perverse incentive — a scenario that grew a setup step raised
 * its own failure floor from 0.750 to 0.800 and so "scored better" while broken.
 *
 * Keyed on what the step DOES, not what it is called. The teardown guard in `synthetic_runner.ts`
 * previously keyed on the id being exactly `start-daemon` and missed the 25 scenarios using
 * `restart-daemon`; naming convention is enforced by nothing.
 *
 * An explicit `step_weight` overrides this, so a scenario genuinely asserting something about
 * daemon lifecycle can still weigh it.
 */
function defaultStepWeight(step: IStepScoreInput["step"]): number {
  return isDaemonLifecycleStep(step) ? 0 : DEFAULT_STEP_WEIGHT;
}

function isDaemonLifecycleStep(step: IStepScoreInput["step"]): boolean {
  if (step.command !== "daemon") return false;
  return (step.args ?? []).some((arg) => arg === "start" || arg === "stop" || arg === "restart");
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
    const weight = outcome.step.step_weight ?? defaultStepWeight(outcome.step);
    totalWeight += weight;
    weightedSum += outcome.score * weight;
  }

  if (totalWeight === 0) return 0.0;
  return weightedSum / totalWeight;
}

/**
 * Phase 143 Step 3 — apply the security gate to an already-computed suite score.
 * The additive suite score already folds both channels (outcome + process, i.e. OUTPUT
 * and INPUT criterion phases) as a weighted mean over steps; gated scoring multiplies it
 * by a gate that is 0 exactly when ANY `class: security` criterion FAILED, matching
 * Harness-Bench's Security·Completion·Process semantics. An identity when nothing
 * security-class failed, so the additive default is byte-identical for existing scenarios.
 */
export function composeGated(
  suiteScore: number,
  criterionResults: ICriterionResult[],
): number {
  const securityViolation = criterionResults.some(
    (result) => result.class === CriterionClass.SECURITY && result.status === CriterionStatus.FAILED,
  );
  return securityViolation ? 0 : suiteScore;
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
