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

/** Fraction of the top-k retrieved slots that are ground-truth relevant:
 * |relevant ∩ retrieved_top_k| / k. */
export function computePrecisionAtK(
  retrievedIds: readonly string[],
  groundTruthIds: readonly string[],
  k: number,
): number {
  const topK = retrievedIds.slice(0, k);
  const relevant = new Set(groundTruthIds);
  const hits = topK.filter((id) => relevant.has(id)).length;
  return hits / k;
}

/** Reciprocal rank of the first relevant id in the retrieved list (1-indexed): 1/rank,
 * or 0 if none is retrieved. Averaged across a corpus this is "mean reciprocal rank". */
export function computeReciprocalRank(
  retrievedIds: readonly string[],
  groundTruthIds: readonly string[],
): number {
  const relevant = new Set(groundTruthIds);
  const rank = retrievedIds.findIndex((id) => relevant.has(id));
  return rank === -1 ? 0 : 1 / (rank + 1);
}

/** DCG@k of the retrieval order over the DCG@k of the ideal order (graded relevance).
 * An id absent from `relevance` counts as 0; returns 0 (not NaN) when no item is relevant. */
export function computeNdcgAtK(
  retrievedIds: readonly string[],
  relevance: Readonly<Record<string, number>>,
  k: number,
): number {
  const gradeOf = (id: string): number => relevance[id] ?? 0;
  const dcg = (ids: readonly string[]): number =>
    ids.slice(0, k).reduce((sum, id, index) => sum + (Math.pow(2, gradeOf(id)) - 1) / Math.log2(index + 2), 0);

  const idealOrder = Object.keys(relevance).sort((a, b) => gradeOf(b) - gradeOf(a));
  const idealDcg = dcg(idealOrder);
  if (idealDcg === 0) return 0;

  return dcg(retrievedIds) / idealDcg;
}

/** 1 iff the system declined (retrieved nothing) when no relevant memory exists; 0 if it
 * fabricates any memory at all — no partial credit for fabricating fewer items. */
export function computeAbstentionCorrect(retrievedIds: readonly string[]): number {
  return retrievedIds.length === 0 ? 1 : 0;
}
