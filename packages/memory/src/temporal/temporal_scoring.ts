/**
 * @module TemporalScoring
 * @path packages/memory/src/temporal/temporal_scoring.ts
 * @description Pure temporal-aware retrieval scoring for learnings: filters ranked candidates to
 *   APPROVED status (the embedding index is status-blind) and re-weights each
 *   candidate's base relevance by recency using a configurable half-life, so newer/current
 *   learnings outrank stale or superseded ones. Deterministic — no LLM in the ranking hot path.
 * @architectural-layer Services
 * @related-files ["packages/memory/src/session/session_memory.ts", "packages/memory/src/bank/memory_search.ts", "packages/core/src/types/constants.ts", "packages/schemas/src/memory_bank.ts"]
 */
import type { ILearning } from "@exaix/schemas/memory_bank.ts";
import { MemoryStatus } from "@exaix/core/status";

/** A retrieval candidate paired with its bank learning record (the source of status and created_at). */
export interface ITemporalCandidate {
  id: string;
  /** Base relevance from the retrieval signal (embedding similarity or keyword relevance), before temporal weighting. */
  baseScore: number;
  learning: ILearning;
}

/** Parameters for temporal scoring. */
export interface ITemporalScoringOptions {
  now: Date;
  halfLifeDays: number;
}

/** Milliseconds in one day, used to express a learning's age in days. */
const MS_PER_DAY = 86_400_000;
/** Exponential decay base of the recency factor: a learning exactly one half-life old weighs half its base score. */
const HALF_LIFE_DECAY_BASE = 0.5;

/** Exponential recency decay: 1.0 at creation, 0.5 at exactly `halfLifeDays` age; unparseable timestamps are treated as fresh and future timestamps clamp to full weight. */
export function computeRecencyFactor(createdAt: string, now: Date, halfLifeDays: number): number {
  const createdMs = Date.parse(createdAt);
  if (!Number.isFinite(createdMs)) return 1;
  const ageDays = Math.max(0, (now.getTime() - createdMs) / MS_PER_DAY);
  return Math.pow(HALF_LIFE_DECAY_BASE, ageDays / halfLifeDays);
}

/** Filters to APPROVED (supersession is the strong signal, recency the soft one), re-weights each survivor by its recency factor, then sorts descending — stable for equal scores. */
export function rankByTemporalRelevance(
  candidates: ITemporalCandidate[],
  options: ITemporalScoringOptions,
): ITemporalCandidate[] {
  return candidates
    .filter((candidate) => candidate.learning.status === MemoryStatus.APPROVED)
    .map((candidate) => ({
      ...candidate,
      baseScore: Math.min(
        1,
        candidate.baseScore *
          computeRecencyFactor(candidate.learning.created_at, options.now, options.halfLifeDays),
      ),
    }))
    .sort((a, b) => b.baseScore - a.baseScore);
}
