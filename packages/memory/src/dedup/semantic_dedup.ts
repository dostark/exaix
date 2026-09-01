/**
 * @module SemanticDedup
 * @path packages/memory/src/dedup/semantic_dedup.ts
 * @description Pure semantic-duplicate detection and merge for approved learnings: picks the
 *   strongest embedding-similarity match at or above a threshold, and merges two learnings by
 *   unioning their tags/references while keeping the higher-quality title/description.
 * @architectural-layer Services
 * @related-files ["packages/memory/src/bank/memory_bank.ts", "packages/schemas/src/memory_bank.ts"]
 */
import type { ILearning, ILearningReference } from "@exaix/schemas/memory_bank.ts";
import type { Opt, Reason } from "@exaix/core/types";

/** A learning already in the bank paired with its embedding similarity to the incoming candidate. */
export interface IDedupCandidate {
  learning: ILearning;
  similarity: number;
}

/** Mirrors LearningSchema's tags cap so a merge can never produce an invalid record. */
const MAX_MERGED_TAGS = 10;
const DEFAULT_QUALITY_SCORE = 0;

/** Returns the strongest candidate at or above `threshold`, or undefined if none qualify. */
export function findDedupMatch(candidates: IDedupCandidate[], threshold: number): IDedupCandidate | undefined {
  let best: IDedupCandidate | undefined;
  for (const candidate of candidates) {
    if (candidate.similarity < threshold) continue;
    if (!best || candidate.similarity > best.similarity) {
      best = candidate;
    }
  }
  return best;
}

/** Unions tags/references and keeps the higher-`quality_score` title/description/confidence; retains `incoming`'s identity fields so the result can supersede `existing`. */
export function mergeLearnings(incoming: ILearning, existing: ILearning): ILearning {
  const incomingQuality = incoming.quality_score ?? DEFAULT_QUALITY_SCORE;
  const existingQuality = existing.quality_score ?? DEFAULT_QUALITY_SCORE;
  const base = incomingQuality >= existingQuality ? incoming : existing;
  const tags = Array.from(new Set([...incoming.tags, ...existing.tags])).slice(0, MAX_MERGED_TAGS);
  const references = mergeReferences(incoming.references, existing.references);

  return {
    ...incoming,
    title: base.title,
    description: base.description,
    confidence: base.confidence,
    quality_score: Math.max(incomingQuality, existingQuality) || undefined,
    tags,
    references,
  };
}

function mergeReferences(
  a: Opt<ILearningReference[], Reason.OptionalInput>,
  b: Opt<ILearningReference[], Reason.OptionalInput>,
): ILearningReference[] | undefined {
  const all = [...(a ?? []), ...(b ?? [])];
  if (all.length === 0) return undefined;
  const seen = new Set<string>();
  const unioned: ILearningReference[] = [];
  for (const reference of all) {
    const key = `${reference.type}:${reference.path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unioned.push(reference);
  }
  return unioned;
}
