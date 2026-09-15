/**
 * @module ScenarioFrameworkArmComparison
 * @path tests/scenario_framework/runner/arm_comparison.ts
 * @description The measurement contract for Phase 158's value-evaluation tier: paired
 * treatment/control arms, trial-aware confidence intervals, value-per-1k-tokens, and
 * pre-registration enforcement. Reuses `computeMultiTrialMetrics` (scoring.ts) for
 * within-task trial variance rather than re-deriving it. Pure computation only — arm mechanics (how a
 * suppression list or catalog overlay actually varies a run) are Step 2's concern; this
 * module only turns already-collected trial scores into a paired delta.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/scoring.ts, tests/scenario_framework/tests/unit/paired_delta_test.ts, tests/scenario_framework/tests/unit/no_effect_rule_test.ts, tests/scenario_framework/tests/unit/value_per_token_test.ts, tests/scenario_framework/tests/unit/preregistration_test.ts]
 */

import { computeMultiTrialMetrics, type IMultiTrialMetrics } from "./scoring.ts";

/** The six ways a run's configuration can differ between a control and a treatment arm
 *  ("Arms as configuration overlays"). */
export enum ArmKind {
  SKILL_ABLATION = "skill-ablation",
  SKILL_VERSION = "skill-version",
  AGENT_ROLE_SWAP = "agent-role-swap",
  AGENT_ROLE_CONFIG = "agent-role-config",
  AGENT_ROLE_PERSONA_ISOLATION = "agent-role-persona-isolation",
  FLOW_ABLATION = "flow-ablation",
  FLOW_SWAP = "flow-swap",
  /** The harness-lift arm — the full Exaix cell (treatment) vs the bare delegate baseline
   *  cell (control) on the outcome channel only (bare cells have no journal, so process-channel
   *  criteria are excluded from both sides). */
  HARNESS_ABLATION = "harness-ablation",
  /** Feature-ablation arms — the full-config cell (treatment) vs an `ablate-<subsystem>` cell
   *  (control) with exactly one subsystem toggled off. SKILL_ABLATION is reused; quality-gate
   *  and portal-knowledge join it for the three-factor ablation set. */
  QUALITY_GATE_ABLATION = "quality-gate-ablation",
  PORTAL_KNOWLEDGE_ABLATION = "portal-knowledge-ablation",
}

/** Which recorded metric a comparison measures the delta on. */
export enum ComparisonMetric {
  OBJECTIVE_OUTCOME = "objective_outcome",
  JUDGE_SCORE = "judge_score",
  PROMPT_TOKENS = "prompt_tokens",
  /** Flow orchestration's wall-clock cost, kept separate from token cost since a flow can
   *  be token-cheap but slow (or the reverse). */
  WALL_CLOCK_MS = "wall_clock_ms",
}

/** A human-readable label for one side of an arm; the concrete overlay/suppression
 *  mechanism that realizes it is out of this module's scope. */
export interface IArmConfig {
  description: string;
}

/** The pre-registered declaration of a comparison — what will be compared, and how,
 *  declared before any trial runs (Design Decision 1). Persisted in the run manifest. */
export interface IArmComparisonSpec {
  armId: string;
  kind: ArmKind;
  control: IArmConfig;
  treatment: IArmConfig;
  taskIds: string[];
  trials: number;
  metric: ComparisonMetric;
  registeredAt: string;
}

/** Raw per-task trial scores for both arms, already collected. */
export interface ITaskTrialInput {
  taskId: string;
  control: number[];
  treatment: number[];
}

export interface IComparisonInput {
  armId: string;
  metric: ComparisonMetric;
  tasks: ITaskTrialInput[];
}

export interface ITaskPairedResult {
  taskId: string;
  controlMetrics: IMultiTrialMetrics;
  treatmentMetrics: IMultiTrialMetrics;
  /** treatment.mean - control.mean for this task. */
  delta: number;
}

export interface IPairedComparisonResult {
  armId: string;
  metric: ComparisonMetric;
  perTask: ITaskPairedResult[];
  /** Mean of per-task deltas. */
  meanDelta: number;
  /** Population standard deviation of per-task deltas across the task set. */
  stdevDelta: number;
  /** Count of tasks whose delta sign strictly opposes the sign of meanDelta. A
   *  zero-delta task neither agrees nor disagrees. */
  signDisagreementCount: number;
  /** True when the paired-trial confidence interval includes zero or the estimated
   *  effect is below the declared minimum effect. */
  noEffect: boolean;
  confidenceLevel: number;
  confidenceInterval: IConfidenceInterval;
  minimumEffect: number;
  pairedTrialCount: number;
  decisionBasis: PairedDecisionBasis;
}

export interface IConfidenceInterval {
  lower: number;
  upper: number;
}

export enum PairedDecisionBasis {
  CONFIDENCE_INTERVAL_INCLUDES_ZERO = "confidence-interval-includes-zero",
  BELOW_MINIMUM_EFFECT = "below-minimum-effect",
  MEASURABLE_EFFECT = "measurable-effect",
}

export const PERSONA_CONFIDENCE_LEVEL = 0.95;
export const MIN_PERSONA_EFFECT = 0.01;

const NORMAL_CRITICAL_95 = 1.96;
const STUDENT_T_CRITICAL_95 = [
  0,
  12.706,
  4.303,
  3.182,
  2.776,
  2.571,
  2.447,
  2.365,
  2.306,
  2.262,
  2.228,
  2.201,
  2.179,
  2.16,
  2.145,
  2.131,
  2.12,
  2.11,
  2.101,
  2.093,
  2.086,
  2.08,
  2.074,
  2.069,
  2.064,
  2.06,
  2.056,
  2.052,
  2.048,
  2.045,
  2.042,
] as const;

function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function populationStdev(values: number[], aroundMean: number): number {
  const variance = values.reduce((sum, v) => sum + (v - aroundMean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function sampleStdev(values: number[], aroundMean: number): number {
  if (values.length < 2) return 0;
  const variance = values.reduce((sum, value) => sum + (value - aroundMean) ** 2, 0) /
    (values.length - 1);
  return Math.sqrt(variance);
}

function studentTCritical95(degreesOfFreedom: number): number {
  return STUDENT_T_CRITICAL_95[degreesOfFreedom] ?? NORMAL_CRITICAL_95;
}

function computeConfidenceInterval(values: number[], valueMean: number): IConfidenceInterval {
  if (values.length < 2) return { lower: valueMean, upper: valueMean };
  const margin = studentTCritical95(values.length - 1) * sampleStdev(values, valueMean) /
    Math.sqrt(values.length);
  return { lower: valueMean - margin, upper: valueMean + margin };
}

/** Computes paired deltas, cross-task spread, trial-aware confidence, and the no-effect verdict. */
export function computePairedComparison(input: IComparisonInput): IPairedComparisonResult {
  const pairedTrialDeltas: number[] = [];
  const perTask: ITaskPairedResult[] = input.tasks.map((task) => {
    if (task.control.length === 0 || task.control.length !== task.treatment.length) {
      throw new Error("Paired comparison requires equal-length, non-empty trial arrays");
    }
    for (let index = 0; index < task.control.length; index++) {
      pairedTrialDeltas.push(task.treatment[index] - task.control[index]);
    }
    const controlMetrics = computeMultiTrialMetrics(task.control);
    const treatmentMetrics = computeMultiTrialMetrics(task.treatment);
    return {
      taskId: task.taskId,
      controlMetrics,
      treatmentMetrics,
      delta: treatmentMetrics.mean - controlMetrics.mean,
    };
  });

  const deltas = perTask.map((t) => t.delta);
  const meanDelta = deltas.length > 0 ? mean(deltas) : 0;
  const stdevDelta = deltas.length > 0 ? populationStdev(deltas, meanDelta) : 0;

  const aggregateSign = Math.sign(meanDelta);
  const signDisagreementCount = perTask.filter((t) => {
    const taskSign = Math.sign(t.delta);
    return taskSign !== 0 && aggregateSign !== 0 && taskSign !== aggregateSign;
  }).length;

  const pairedTrialMean = pairedTrialDeltas.length > 0 ? mean(pairedTrialDeltas) : 0;
  const confidenceInterval = computeConfidenceInterval(pairedTrialDeltas, pairedTrialMean);
  const intervalIncludesZero = confidenceInterval.lower <= 0 && confidenceInterval.upper >= 0;
  const belowMinimumEffect = Math.abs(pairedTrialMean) < MIN_PERSONA_EFFECT;
  const decisionBasis = intervalIncludesZero
    ? PairedDecisionBasis.CONFIDENCE_INTERVAL_INCLUDES_ZERO
    : belowMinimumEffect
    ? PairedDecisionBasis.BELOW_MINIMUM_EFFECT
    : PairedDecisionBasis.MEASURABLE_EFFECT;
  const noEffect = intervalIncludesZero || belowMinimumEffect;

  return {
    armId: input.armId,
    metric: input.metric,
    perTask,
    meanDelta,
    stdevDelta,
    signDisagreementCount,
    noEffect,
    confidenceLevel: PERSONA_CONFIDENCE_LEVEL,
    confidenceInterval,
    minimumEffect: MIN_PERSONA_EFFECT,
    pairedTrialCount: pairedTrialDeltas.length,
    decisionBasis,
  };
}

// value-per-1k-tokens = deltaScore / (deltaPromptTokens / 1000). A zero token cost with a
// nonzero score delta is a free win, represented as +/-Infinity (not a large finite number) so
// it never loses a ranking comparison. A zero delta on both axes is exactly zero (not NaN).
export function computeValuePerToken(deltaScore: number, deltaPromptTokens: number): number {
  if (deltaPromptTokens === 0) {
    if (deltaScore === 0) return 0;
    return deltaScore > 0 ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
  }
  return deltaScore / (deltaPromptTokens / 1000);
}

// Rejects a comparison whose arm, metric, or any requested task was not declared in
// `preregistered` before execution. Requesting a strict subset of the declared task set is
// allowed — screening passes run a task subset by design; only tasks OUTSIDE it are a violation.
export function validatePreregistration(
  preregistered: IArmComparisonSpec,
  actual: { armId: string; metric: ComparisonMetric; taskIds: string[] },
): void {
  if (preregistered.armId !== actual.armId) {
    throw new Error(
      `Pre-registration violation: arm "${actual.armId}" has no pre-registered comparison ` +
        `(pre-registered arm is "${preregistered.armId}").`,
    );
  }
  if (preregistered.metric !== actual.metric) {
    throw new Error(
      `Pre-registration violation: metric "${actual.metric}" was not declared before ` +
        `execution for arm "${actual.armId}" (pre-registered metric is "${preregistered.metric}").`,
    );
  }
  const registeredTaskIds = new Set(preregistered.taskIds);
  const undeclaredTasks = actual.taskIds.filter((id) => !registeredTaskIds.has(id));
  if (undeclaredTasks.length > 0) {
    throw new Error(
      `Pre-registration violation: task(s) ${undeclaredTasks.join(", ")} were not declared ` +
        `before execution for arm "${actual.armId}".`,
    );
  }
}
