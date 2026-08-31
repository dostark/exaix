/**
 * @module ScenarioFrameworkArmComparison
 * @path tests/scenario_framework/runner/arm_comparison.ts
 * @description The measurement contract for Phase 158's value-evaluation tier: paired
 * treatment/control arms, deltas with variance, value-per-1k-tokens, and pre-registration
 * enforcement. Reuses `computeMultiTrialMetrics` (scoring.ts) for within-task trial
 * variance rather than re-deriving it. Pure computation only — arm mechanics (how a
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
  IDENTITY_SWAP = "identity-swap",
  IDENTITY_CONFIG = "identity-config",
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
  /** True when |meanDelta| is smaller than stdevDelta — the aggregate cannot be
   *  distinguished from noise and must be reported as no effect, not a small effect
   *  (Measurement contract, "Aggregate across T"). */
  noEffect: boolean;
}

function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function populationStdev(values: number[], aroundMean: number): number {
  const variance = values.reduce((sum, v) => sum + (v - aroundMean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

/** Computes the paired delta, its cross-task variance, sign-disagreement count, and the no-effect verdict for a set of already-collected per-task trial scores. */
export function computePairedComparison(input: IComparisonInput): IPairedComparisonResult {
  const perTask: ITaskPairedResult[] = input.tasks.map((task) => {
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

  const noEffect = Math.abs(meanDelta) < stdevDelta;

  return {
    armId: input.armId,
    metric: input.metric,
    perTask,
    meanDelta,
    stdevDelta,
    signDisagreementCount,
    noEffect,
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
