/**
 * @module ConsolidationMetrics
 * @path tests/scenario_framework/runner/consolidation_metrics.ts
 * @description Pure consolidation-quality metric functions for the Phase 148 Memory
 * Evaluation Framework: dedup rate, contradiction-resolution correctness, and
 * staleness (current-over-retired retrieval preference). Sibling of
 * retrieval_metrics.ts — same deterministic, provider-free design.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/tests/unit/dedup_metric_test.ts, tests/scenario_framework/tests/unit/contradiction_metric_test.ts, tests/scenario_framework/tests/unit/staleness_metric_test.ts]
 */

/** Fraction of near-duplicate learnings actually removed (superseded) by a
 * consolidation pass: duplicatesRemoved / nearDuplicatesPresent. */
export function computeDedupRate(duplicatesRemoved: number, nearDuplicatesPresent: number): number {
  if (nearDuplicatesPresent === 0) {
    throw new Error("computeDedupRate requires at least one near-duplicate present");
  }
  return duplicatesRemoved / nearDuplicatesPresent;
}

/** Fraction of update/supersede cases whose resulting store state was correct. */
export function computeContradictionCorrect(outcomes: readonly boolean[]): number {
  if (outcomes.length === 0) {
    throw new Error("computeContradictionCorrect requires at least one outcome");
  }
  return outcomes.filter(Boolean).length / outcomes.length;
}

/** 1 iff retrieval both surfaces the current id and excludes every retired id; 0
 * otherwise (missing the current fact, or still surfacing a retired one). */
export function computeStalenessCorrect(
  retrievedIds: readonly string[],
  currentId: string,
  retiredIds: readonly string[],
): number {
  const hasCurrent = retrievedIds.includes(currentId);
  const hasNoRetired = retiredIds.every((id) => !retrievedIds.includes(id));
  return hasCurrent && hasNoRetired ? 1 : 0;
}
