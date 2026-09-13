/**
 * @module RetrievalMetrics
 * @path tests/scenario_framework/runner/retrieval_metrics.ts
 * @description Pure retrieval-quality metric functions for the Phase 148 Memory
 * Evaluation Framework, scored over (retrieved ids, ground-truth ids) with no
 * provider/LLM involvement — deterministic and CI-safe.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/tests/unit/recall_at_k_test.ts, tests/scenario_framework/schema/step_schema.ts, tests/scenario_framework/runner/assertions.ts]
 */

/** Fraction of ground-truth-relevant ids present in the top-k retrieved ids:
 * |relevant ∩ retrieved_top_k| / |relevant|. */
export function computeRecallAtK(
  retrievedIds: readonly string[],
  groundTruthIds: readonly string[],
  k: number,
): number {
  if (groundTruthIds.length === 0) {
    throw new Error("computeRecallAtK requires at least one ground-truth id");
  }
  const topK = retrievedIds.slice(0, k);
  const relevant = new Set(groundTruthIds);
  const hits = topK.filter((id) => relevant.has(id)).length;
  return hits / groundTruthIds.length;
}
