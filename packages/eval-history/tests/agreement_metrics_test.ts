/**
 * @module AgreementMetricsTest
 * @path packages/eval-history/tests/agreement_metrics_test.ts
 * @description Phase 146 Step 1 — hand-computed judge-reference agreement metrics:
 *   exact agreement, Cohen's kappa, and Krippendorff's interval alpha, plus their
 *   degenerate/error edge cases (empty, one-pair, constant labels, mismatched ids,
 *   invalid scores, threshold boundary).
 * @architectural-layer Test
 * @related-files [packages/eval-history/src/calibration/metrics.ts]
 */

import { assertEquals, assertThrows } from "@std/assert";
import {
  alignCalibrationPairs,
  CalibrationLabel,
  CalibrationMetricError,
  CalibrationMetricErrorCode,
  computeCohenKappa,
  computeExactAgreement,
  computeIntervalAlpha,
  deriveCalibrationLabel,
  type ICalibrationScoredItem,
  MetricUndefinedReason,
} from "../src/calibration/metrics.ts";

const THRESHOLD = 0.7;

function items(scores: ReadonlyArray<[string, number]>): ICalibrationScoredItem[] {
  return scores.map(([id, score]) => ({ id, score }));
}

Deno.test("[AgreementMetrics] deriveCalibrationLabel — threshold edges", () => {
  assertEquals(deriveCalibrationLabel(0.7, THRESHOLD), CalibrationLabel.Pass);
  assertEquals(deriveCalibrationLabel(0.699999, THRESHOLD), CalibrationLabel.Fail);
  assertEquals(deriveCalibrationLabel(1, THRESHOLD), CalibrationLabel.Pass);
  assertEquals(deriveCalibrationLabel(0, THRESHOLD), CalibrationLabel.Fail);
});

Deno.test("[AgreementMetrics] alignCalibrationPairs — sorts by id and pairs matching ids", () => {
  const targets = items([["b", 0.9], ["a", 0.1]]);
  const references = items([["a", 0.2], ["b", 0.8]]);

  const pairs = alignCalibrationPairs(targets, references);

  assertEquals(pairs.map((pair) => pair.id), ["a", "b"]);
  assertEquals(pairs[0], { id: "a", targetScore: 0.1, referenceScore: 0.2 });
  assertEquals(pairs[1], { id: "b", targetScore: 0.9, referenceScore: 0.8 });
});

Deno.test("[AgreementMetrics] alignCalibrationPairs — throws on duplicate target id", () => {
  const targets = items([["a", 0.1], ["a", 0.2]]);
  const references = items([["a", 0.1]]);

  const error = assertThrows(
    () => alignCalibrationPairs(targets, references),
    CalibrationMetricError,
  );
  assertEquals(error.code, CalibrationMetricErrorCode.DuplicateId);
});

Deno.test("[AgreementMetrics] alignCalibrationPairs — throws on duplicate reference id", () => {
  const targets = items([["a", 0.1]]);
  const references = items([["a", 0.1], ["a", 0.2]]);

  const error = assertThrows(
    () => alignCalibrationPairs(targets, references),
    CalibrationMetricError,
  );
  assertEquals(error.code, CalibrationMetricErrorCode.DuplicateId);
});

Deno.test("[AgreementMetrics] alignCalibrationPairs — throws on unequal id sets (different lengths)", () => {
  const targets = items([["a", 0.1], ["b", 0.2]]);
  const references = items([["a", 0.1]]);

  const error = assertThrows(
    () => alignCalibrationPairs(targets, references),
    CalibrationMetricError,
  );
  assertEquals(error.code, CalibrationMetricErrorCode.IdSetMismatch);
});

Deno.test("[AgreementMetrics] alignCalibrationPairs — throws on unequal id sets (same length, different ids)", () => {
  const targets = items([["a", 0.1], ["b", 0.2]]);
  const references = items([["a", 0.1], ["c", 0.2]]);

  const error = assertThrows(
    () => alignCalibrationPairs(targets, references),
    CalibrationMetricError,
  );
  assertEquals(error.code, CalibrationMetricErrorCode.IdSetMismatch);
});

Deno.test("[AgreementMetrics] alignCalibrationPairs — throws on non-finite score", () => {
  const targets = items([["a", Number.POSITIVE_INFINITY]]);
  const references = items([["a", 0.5]]);

  const error = assertThrows(
    () => alignCalibrationPairs(targets, references),
    CalibrationMetricError,
  );
  assertEquals(error.code, CalibrationMetricErrorCode.InvalidScore);
});

Deno.test("[AgreementMetrics] alignCalibrationPairs — throws on out-of-range score", () => {
  const targets = items([["a", 1.1]]);
  const references = items([["a", 0.5]]);

  const error = assertThrows(
    () => alignCalibrationPairs(targets, references),
    CalibrationMetricError,
  );
  assertEquals(error.code, CalibrationMetricErrorCode.InvalidScore);
});

Deno.test("[AgreementMetrics] computeExactAgreement — empty set is insufficient-data", () => {
  const result = computeExactAgreement([], THRESHOLD);
  assertEquals(result, { value: null, reason: MetricUndefinedReason.InsufficientData });
});

Deno.test("[AgreementMetrics] computeExactAgreement — one pair is well-defined (match)", () => {
  const pairs = alignCalibrationPairs(items([["a", 0.9]]), items([["a", 0.95]]));
  assertEquals(computeExactAgreement(pairs, THRESHOLD), { value: 1 });
});

Deno.test("[AgreementMetrics] computeExactAgreement — one pair is well-defined (mismatch)", () => {
  const pairs = alignCalibrationPairs(items([["a", 0.9]]), items([["a", 0.1]]));
  assertEquals(computeExactAgreement(pairs, THRESHOLD), { value: 0 });
});

Deno.test("[AgreementMetrics] computeExactAgreement — hand-computed 3/4", () => {
  const pairs = alignCalibrationPairs(
    items([["a", 0.9], ["b", 0.9], ["c", 0.1], ["d", 0.1]]),
    items([["a", 0.9], ["b", 0.1], ["c", 0.1], ["d", 0.1]]),
  );
  assertEquals(computeExactAgreement(pairs, THRESHOLD), { value: 0.75 });
});

Deno.test("[AgreementMetrics] computeCohenKappa — one pair is insufficient-data", () => {
  const pairs = alignCalibrationPairs(items([["a", 0.9]]), items([["a", 0.95]]));
  assertEquals(computeCohenKappa(pairs, THRESHOLD), {
    value: null,
    reason: MetricUndefinedReason.InsufficientData,
  });
});

Deno.test("[AgreementMetrics] computeCohenKappa — perfect agreement (varied labels) is kappa 1", () => {
  const pairs = alignCalibrationPairs(
    items([["a", 0.9], ["b", 0.9], ["c", 0.1], ["d", 0.1]]),
    items([["a", 0.95], ["b", 0.8], ["c", 0.2], ["d", 0.05]]),
  );
  const result = computeCohenKappa(pairs, THRESHOLD);
  assertEquals(result.value !== null, true);
  assertEquals(Math.abs((result as { value: number }).value - 1) < 1e-9, true);
});

Deno.test("[AgreementMetrics] computeCohenKappa — chance-level agreement is kappa 0", () => {
  const pairs = alignCalibrationPairs(
    items([["a", 0.9], ["b", 0.9], ["c", 0.1], ["d", 0.1]]),
    items([["a", 0.9], ["b", 0.1], ["c", 0.9], ["d", 0.1]]),
  );
  const result = computeCohenKappa(pairs, THRESHOLD);
  assertEquals(result.value !== null, true);
  assertEquals(Math.abs((result as { value: number }).value - 0) < 1e-9, true);
});

Deno.test("[AgreementMetrics] computeCohenKappa — full disagreement is kappa -1", () => {
  const pairs = alignCalibrationPairs(
    items([["a", 0.9], ["b", 0.1]]),
    items([["a", 0.1], ["b", 0.9]]),
  );
  const result = computeCohenKappa(pairs, THRESHOLD);
  assertEquals(result.value !== null, true);
  assertEquals(Math.abs((result as { value: number }).value - -1) < 1e-9, true);
});

Deno.test("[AgreementMetrics] computeCohenKappa — constant matching labels is zero-expected-disagreement", () => {
  const pairs = alignCalibrationPairs(
    items([["a", 0.9], ["b", 0.95], ["c", 1]]),
    items([["a", 0.8], ["b", 0.85], ["c", 0.9]]),
  );
  assertEquals(computeCohenKappa(pairs, THRESHOLD), {
    value: null,
    reason: MetricUndefinedReason.ZeroExpectedDisagreement,
  });
});

Deno.test("[AgreementMetrics] computeIntervalAlpha — one pair is insufficient-data", () => {
  const pairs = alignCalibrationPairs(items([["a", 0.9]]), items([["a", 0.95]]));
  assertEquals(computeIntervalAlpha(pairs), {
    value: null,
    reason: MetricUndefinedReason.InsufficientData,
  });
});

Deno.test("[AgreementMetrics] computeIntervalAlpha — perfect agreement is alpha 1", () => {
  const pairs = alignCalibrationPairs(
    items([["a", 0.2], ["b", 0.4], ["c", 0.6], ["d", 0.8]]),
    items([["a", 0.2], ["b", 0.4], ["c", 0.6], ["d", 0.8]]),
  );
  const result = computeIntervalAlpha(pairs);
  assertEquals(result.value !== null, true);
  assertEquals(Math.abs((result as { value: number }).value - 1) < 1e-9, true);
});

Deno.test("[AgreementMetrics] computeIntervalAlpha — hand-computed disagreement", () => {
  // a = [0, 1], b = [1, 0]. Do = ((0-1)^2 + (1-0)^2) / 2 = 1.
  // Pooled x = [0, 1, 1, 0]; De = sum_{j!=k}(x_j-x_k)^2 / (4*3) = 8/12 = 2/3.
  // alpha = 1 - 1/(2/3) = 1 - 1.5 = -0.5.
  const pairs = alignCalibrationPairs(
    items([["a", 0], ["b", 1]]),
    items([["a", 1], ["b", 0]]),
  );
  const result = computeIntervalAlpha(pairs);
  assertEquals(result.value !== null, true);
  assertEquals(Math.abs((result as { value: number }).value - -0.5) < 1e-9, true);
});

Deno.test("[AgreementMetrics] computeIntervalAlpha — constant identical scores is zero-expected-disagreement", () => {
  const pairs = alignCalibrationPairs(
    items([["a", 0.5], ["b", 0.5], ["c", 0.5]]),
    items([["a", 0.5], ["b", 0.5], ["c", 0.5]]),
  );
  assertEquals(computeIntervalAlpha(pairs), {
    value: null,
    reason: MetricUndefinedReason.ZeroExpectedDisagreement,
  });
});

Deno.test("[AgreementMetrics] computeIntervalAlpha — empty set is insufficient-data", () => {
  assertEquals(computeIntervalAlpha([]), {
    value: null,
    reason: MetricUndefinedReason.InsufficientData,
  });
});
