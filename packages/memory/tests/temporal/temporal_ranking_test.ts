/**
 * @module TemporalRankingTest
 * @path packages/memory/tests/temporal/temporal_ranking_test.ts
 * @description Verifies temporal-aware retrieval scoring: newer APPROVED learnings outrank older ones on the same topic, the half-life boundary is exact, and PENDING/SUPERSEDED/DELETED candidates are excluded regardless of recency (defense against the status-blind embedding index).
 * @architectural-layer Tests
 */
import { assertAlmostEquals, assertEquals } from "@std/assert";
import { MEMORY_TEMPORAL_RECENCY_HALF_LIFE_DAYS, MemoryRecordStatus } from "@exaix/core";
import { MemoryStatus } from "@exaix/core/status";
import { computeRecencyFactor, type ITemporalCandidate, rankByTemporalRelevance } from "@exaix/memory";
import { createSampleLearning } from "@exaix/testing";

const MS_PER_DAY = 86_400_000;
const HALF_LIFE = MEMORY_TEMPORAL_RECENCY_HALF_LIFE_DAYS;

function candidate(
  id: string,
  baseScore: number,
  createdAt: string,
  status: MemoryRecordStatus = MemoryRecordStatus.APPROVED,
): ITemporalCandidate {
  return {
    id,
    baseScore,
    learning: createSampleLearning({ id, status, created_at: createdAt }),
  };
}

function daysAgo(now: Date, days: number): string {
  return new Date(now.getTime() - days * MS_PER_DAY).toISOString();
}

Deno.test("a newer APPROVED learning outranks an older one on the same topic (equal base score)", () => {
  const now = new Date("2026-09-01T12:00:00.000Z");
  const newer = candidate("newer", 0.9, daysAgo(now, 1));
  const older = candidate("older", 0.9, daysAgo(now, 90));

  const ranked = rankByTemporalRelevance([older, newer], { now, halfLifeDays: HALF_LIFE });

  assertEquals(ranked[0].id, "newer");
  assertEquals(ranked[1].id, "older");
  assertEquals(ranked[0].baseScore > ranked[1].baseScore, true);
});

Deno.test("a learning exactly one half-life old weighs exactly half its base score", () => {
  const now = new Date("2026-09-01T12:00:00.000Z");
  const atHalfLife = candidate("at-half-life", 0.8, daysAgo(now, HALF_LIFE));

  const factor = computeRecencyFactor(atHalfLife.learning.created_at, now, HALF_LIFE);
  assertAlmostEquals(factor, 0.5, 1e-9);

  const [scored] = rankByTemporalRelevance([atHalfLife], { now, halfLifeDays: HALF_LIFE });
  assertAlmostEquals(scored.baseScore, 0.4, 1e-9);
});

Deno.test("half-life boundary is directional: below outranks at, at outranks above", () => {
  const now = new Date("2026-09-01T12:00:00.000Z");
  const below = candidate("below", 0.8, daysAgo(now, HALF_LIFE - 1));
  const at = candidate("at", 0.8, daysAgo(now, HALF_LIFE));
  const above = candidate("above", 0.8, daysAgo(now, HALF_LIFE + 1));

  assertEquals(computeRecencyFactor(below.learning.created_at, now, HALF_LIFE) > 0.5, true);
  assertEquals(computeRecencyFactor(above.learning.created_at, now, HALF_LIFE) < 0.5, true);

  const ranked = rankByTemporalRelevance([above, at, below], { now, halfLifeDays: HALF_LIFE });
  assertEquals(ranked.map((c) => c.id), ["below", "at", "above"]);
});

Deno.test("a PENDING candidate never outranks an APPROVED one regardless of recency", () => {
  const now = new Date("2026-09-01T12:00:00.000Z");
  const pendingFresh = candidate("pending-fresh", 0.99, daysAgo(now, 0), MemoryStatus.PENDING);
  const approvedStale = candidate("approved-stale", 0.5, daysAgo(now, 365));

  let ranked = rankByTemporalRelevance([pendingFresh, approvedStale], { now, halfLifeDays: HALF_LIFE });
  assertEquals(ranked.map((c) => c.id), ["approved-stale"]);

  const pendingStale = candidate("pending-stale", 0.99, daysAgo(now, 365), MemoryStatus.PENDING);
  const approvedFresh = candidate("approved-fresh", 0.5, daysAgo(now, 0));
  ranked = rankByTemporalRelevance([pendingStale, approvedFresh], { now, halfLifeDays: HALF_LIFE });
  assertEquals(ranked.map((c) => c.id), ["approved-fresh"]);
});

Deno.test("SUPERSEDED and DELETED candidates are excluded even when fresh and highly similar", () => {
  const now = new Date("2026-09-01T12:00:00.000Z");
  const superseded = candidate("superseded", 0.99, daysAgo(now, 0), MemoryStatus.SUPERSEDED);
  const deleted = candidate("deleted", 0.99, daysAgo(now, 0), MemoryStatus.DELETED);
  const approvedStale = candidate("approved-stale", 0.5, daysAgo(now, 365));

  const ranked = rankByTemporalRelevance([superseded, deleted, approvedStale], { now, halfLifeDays: HALF_LIFE });
  assertEquals(ranked.map((c) => c.id), ["approved-stale"]);
});

Deno.test("an unparseable created_at is treated as fresh (no penalty for corrupt data)", () => {
  const now = new Date("2026-09-01T12:00:00.000Z");
  const corrupt = candidate("corrupt", 0.7, "not-a-timestamp");

  const ranked = rankByTemporalRelevance([corrupt], { now, halfLifeDays: HALF_LIFE });
  assertEquals(ranked.length, 1);
  assertEquals(ranked[0].baseScore, 0.7);
});

Deno.test("recency factor is monotonically non-increasing with age", () => {
  const now = new Date("2026-09-01T12:00:00.000Z");
  const ages = [0, 30, 90, 180, 360, 720, 3650];
  let previous = Number.POSITIVE_INFINITY;
  for (const age of ages) {
    const factor = computeRecencyFactor(daysAgo(now, age), now, HALF_LIFE);
    assertEquals(factor <= previous, true, `factor at ${age}d (${factor}) must not exceed previous (${previous})`);
    previous = factor;
  }
});

Deno.test("scoring is deterministic: identical inputs produce identical ranked output", () => {
  const now = new Date("2026-09-01T12:00:00.000Z");
  const candidates = [candidate("a", 0.9, daysAgo(now, 2)), candidate("b", 0.9, daysAgo(now, 120))];
  const first = rankByTemporalRelevance(candidates, { now, halfLifeDays: HALF_LIFE });
  const second = rankByTemporalRelevance(candidates, { now, halfLifeDays: HALF_LIFE });
  assertEquals(first, second);
});

Deno.test("a future created_at (clock skew) is clamped to a full-weight factor", () => {
  const now = new Date("2026-09-01T12:00:00.000Z");
  const future = candidate("future", 0.7, new Date(now.getTime() + 10 * MS_PER_DAY).toISOString());

  const ranked = rankByTemporalRelevance([future], { now, halfLifeDays: HALF_LIFE });
  assertEquals(ranked.length, 1);
  assertEquals(ranked[0].baseScore, 0.7);
});

Deno.test("recency half-life default is 180 days and config-keyed", () => {
  assertEquals(MEMORY_TEMPORAL_RECENCY_HALF_LIFE_DAYS, 180);
});
