/**
 * @module JudgmentThresholds
 * @path tests/scenario_framework/runner/judgment_thresholds.ts
 * @description Named thresholds for checklist calibration, admission and the pilot.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/judgment_checklist.ts]
 */

/** Allowed absolute difference between the checklist weight sum and 1. */
export const WEIGHT_SUM_TOLERANCE = 1e-9;

/** Minimum critical-question agreement during calibration. */
export const CRITICAL_MIN_AGREEMENT = 0.90;

/** Minimum Cohen's kappa on critical questions. */
export const CRITICAL_MIN_KAPPA = 0.70;

/** Minimum non-critical agreement during calibration. */
export const NONCRITICAL_MIN_AGREEMENT = 0.85;

/** Minimum composite rank correlation with the reference ranking. */
export const MIN_RANK_CORRELATION = 0.8;

/** Maximum spread across repeated runs of the same artifact. */
export const MAX_REPEATED_RUN_SPREAD = 0.05;

/** Repeated runs per artifact during calibration. */
export const REPEAT_COUNT = 5;

/** Artifacts used for the repeated-run subset. */
export const REPEAT_SUBSET_SIZE = 20;

/** Minimum first-attempt schema validity. */
export const MIN_FIRST_ATTEMPT_SCHEMA_VALIDITY = 1.0;

/** Maximum share of artifacts that may escalate. */
export const MAX_ESCALATION_FRACTION = 0.30;

/** Minimum escalated instances needed before the fraction is admitted. */
export const MIN_ESCALATED_INSTANCES = 20;

/** Minimum reference labels per class. */
export const MIN_LABELS_PER_CLASS = 10;

/** Minimum injection artifacts in the calibration set. */
export const MIN_INJECTION_ARTIFACTS = 10;

/** Calibration set size. */
export const CALIBRATION_SET_SIZE = 50;

/** Minimum pilot trials per arm. */
export const MIN_PILOT_TRIALS = 3;
