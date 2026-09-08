/**
 * @module CalibrationMetrics
 * @path packages/eval-history/src/calibration/metrics.ts
 * @description Pure judge-reference agreement metrics for Phase 146 judge calibration:
 *   exact agreement, chance-corrected Cohen's kappa (binary pass/fail), and Krippendorff's
 *   interval alpha (graded 0-1 scores). No provider, filesystem, or config-service
 *   dependencies — every function is a deterministic transform of its arguments.
 * @architectural-layer Shared
 * @dependencies []
 * @related-files [packages/eval-history/src/calibration/schema.ts, packages/eval-history/src/calibration/identity.ts]
 */

/** Canonical judge-reference agreement label, derived from a score, never stored independently. */
export enum CalibrationLabel {
  Pass = "pass",
  Fail = "fail",
}

/** Why a chance-corrected metric could not be computed — never coerced to 0 or 1. */
export enum MetricUndefinedReason {
  InsufficientData = "insufficient-data",
  ZeroExpectedDisagreement = "zero-expected-disagreement",
}

export type IMetricResult =
  | { readonly value: number }
  | { readonly value: null; readonly reason: MetricUndefinedReason };

export enum CalibrationMetricErrorCode {
  DuplicateId = "duplicate-id",
  IdSetMismatch = "id-set-mismatch",
  InvalidScore = "invalid-score",
}

export interface ICalibrationScoredItem {
  readonly id: string;
  readonly score: number;
}

export interface ICalibrationAlignedPair {
  readonly id: string;
  readonly targetScore: number;
  readonly referenceScore: number;
}

export class CalibrationMetricError extends Error {
  constructor(public readonly code: CalibrationMetricErrorCode, message: string) {
    super(message);
    this.name = "CalibrationMetricError";
  }
}

const MIN_CHANCE_CORRECTED_PAIRS = 2;
const METRIC_EPSILON = 1e-12;

function assertValidUnitScore(id: string, score: number): void {
  if (!Number.isFinite(score) || score < 0 || score > 1) {
    throw new CalibrationMetricError(
      CalibrationMetricErrorCode.InvalidScore,
      `Calibration item "${id}" has an invalid score (must be finite and within [0,1]): ${score}`,
    );
  }
}

function assertNoDuplicateIds(items: readonly ICalibrationScoredItem[], side: string): void {
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.id)) {
      throw new CalibrationMetricError(
        CalibrationMetricErrorCode.DuplicateId,
        `Duplicate ${side} calibration item id: "${item.id}"`,
      );
    }
    seen.add(item.id);
  }
}

/** Aligns target/reference scores by exact item id (throws on duplicate/mismatched
 *  ids or an invalid score); returns pairs sorted ascending by id. */
export function alignCalibrationPairs(
  targets: readonly ICalibrationScoredItem[],
  references: readonly ICalibrationScoredItem[],
): ICalibrationAlignedPair[] {
  assertNoDuplicateIds(targets, "target");
  assertNoDuplicateIds(references, "reference");

  const referenceById = new Map(references.map((item) => [item.id, item]));
  const targetIds = new Set(targets.map((item) => item.id));

  if (targetIds.size !== referenceById.size) {
    throw new CalibrationMetricError(
      CalibrationMetricErrorCode.IdSetMismatch,
      `Target set has ${targetIds.size} ids but reference set has ${referenceById.size}`,
    );
  }

  const pairs: ICalibrationAlignedPair[] = [];
  for (const target of targets) {
    const reference = referenceById.get(target.id);
    if (!reference) {
      throw new CalibrationMetricError(
        CalibrationMetricErrorCode.IdSetMismatch,
        `Target item "${target.id}" has no matching reference item`,
      );
    }
    assertValidUnitScore(target.id, target.score);
    assertValidUnitScore(reference.id, reference.score);
    pairs.push({ id: target.id, targetScore: target.score, referenceScore: reference.score });
  }

  return pairs.sort((left, right) => left.id.localeCompare(right.id));
}

/** Canonical binary label for a score: pass iff score >= threshold. */
export function deriveCalibrationLabel(score: number, threshold: number): CalibrationLabel {
  return score >= threshold ? CalibrationLabel.Pass : CalibrationLabel.Fail;
}

/** Fraction of aligned pairs whose derived target/reference labels match. Requires n >= 1. */
export function computeExactAgreement(
  pairs: readonly ICalibrationAlignedPair[],
  threshold: number,
): IMetricResult {
  if (pairs.length === 0) {
    return { value: null, reason: MetricUndefinedReason.InsufficientData };
  }

  const matches = pairs.filter(
    (pair) =>
      deriveCalibrationLabel(pair.targetScore, threshold) ===
        deriveCalibrationLabel(pair.referenceScore, threshold),
  ).length;

  return { value: matches / pairs.length };
}

/** Cohen's kappa = (po - pe) / (1 - pe) over labels derived at `threshold`; undefined
 *  (zero-expected-disagreement) when both sides agree on one constant label (pe = 1). */
export function computeCohenKappa(
  pairs: readonly ICalibrationAlignedPair[],
  threshold: number,
): IMetricResult {
  if (pairs.length < MIN_CHANCE_CORRECTED_PAIRS) {
    return { value: null, reason: MetricUndefinedReason.InsufficientData };
  }

  const n = pairs.length;
  const labeled = pairs.map((pair) => ({
    target: deriveCalibrationLabel(pair.targetScore, threshold),
    reference: deriveCalibrationLabel(pair.referenceScore, threshold),
  }));

  const observedAgreement = labeled.filter((pair) => pair.target === pair.reference).length / n;
  const targetPassRate = labeled.filter((pair) => pair.target === CalibrationLabel.Pass).length / n;
  const referencePassRate = labeled.filter((pair) => pair.reference === CalibrationLabel.Pass).length / n;
  const expectedAgreement = targetPassRate * referencePassRate + (1 - targetPassRate) * (1 - referencePassRate);
  const disagreementRoom = 1 - expectedAgreement;

  if (Math.abs(disagreementRoom) < METRIC_EPSILON) {
    return { value: null, reason: MetricUndefinedReason.ZeroExpectedDisagreement };
  }

  return { value: (observedAgreement - expectedAgreement) / disagreementRoom };
}

/** Krippendorff's interval alpha = 1 - Do/De over raw graded scores (no bucketing);
 *  undefined (zero-expected-disagreement) when every pooled score is identical. */
export function computeIntervalAlpha(pairs: readonly ICalibrationAlignedPair[]): IMetricResult {
  if (pairs.length < MIN_CHANCE_CORRECTED_PAIRS) {
    return { value: null, reason: MetricUndefinedReason.InsufficientData };
  }

  const n = pairs.length;
  const observedDisagreement = pairs.reduce((sum, pair) => sum + (pair.targetScore - pair.referenceScore) ** 2, 0) / n;

  const pooled = [...pairs.map((pair) => pair.targetScore), ...pairs.map((pair) => pair.referenceScore)];
  const pooledCount = pooled.length;

  let pairwiseSquaredDiffSum = 0;
  for (let j = 0; j < pooledCount; j++) {
    for (let k = 0; k < pooledCount; k++) {
      if (j === k) continue;
      pairwiseSquaredDiffSum += (pooled[j] - pooled[k]) ** 2;
    }
  }
  const expectedDisagreement = pairwiseSquaredDiffSum / (pooledCount * (pooledCount - 1));

  if (Math.abs(expectedDisagreement) < METRIC_EPSILON) {
    return { value: null, reason: MetricUndefinedReason.ZeroExpectedDisagreement };
  }

  return { value: 1 - observedDisagreement / expectedDisagreement };
}
