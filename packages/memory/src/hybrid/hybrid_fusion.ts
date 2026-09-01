/**
 * @module HybridFusion
 * @path packages/memory/src/hybrid/hybrid_fusion.ts
 * @description Pure weighted score fusion for hybrid retrieval: combines the vector-similarity and
 *   keyword-relevance signals per candidate identity, so items surfaced by both signals accumulate
 *   score and outrank either signal's top single-signal item. Deterministic — no LLM in the ranking
 *   hot path; a reranker-provider pass can be layered on top later (score fusion is the floor).
 * @architectural-layer Services
 * @related-files ["packages/memory/src/session/session_memory.ts", "packages/core/src/types/constants.ts"]
 */

/**
 * Fuses the two retrieval signals: `fused = vectorWeight * vectorScore + keywordWeight * keywordScore`,
 * with a missing signal contributing zero. Both inputs hold identity-keyed scores bounded [0,1], so
 * fused scores stay in [0,1]. Deterministic.
 */
export function fuseHybridScores(
  vector: Map<string, number>,
  keyword: Map<string, number>,
  vectorWeight: number,
  keywordWeight: number,
): Map<string, number> {
  const fused = new Map<string, number>();
  for (const [identity, score] of vector) {
    fused.set(identity, vectorWeight * score);
  }
  for (const [identity, score] of keyword) {
    fused.set(identity, (fused.get(identity) ?? 0) + keywordWeight * score);
  }
  return fused;
}
