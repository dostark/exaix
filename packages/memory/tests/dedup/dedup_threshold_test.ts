/**
 * @module DedupThresholdTest
 * @path packages/memory/tests/dedup/dedup_threshold_test.ts
 * @description Verifies findDedupMatch's similarity-threshold boundary is inclusive and always returns the strongest qualifying candidate.
 * @architectural-layer Tests
 */
import { assertEquals } from "@std/assert";
import { MemoryStatus } from "@exaix/core/status";
import { findDedupMatch, type IDedupCandidate } from "@exaix/memory";
import { createSampleLearning } from "@exaix/testing";

function candidate(id: string, similarity: number): IDedupCandidate {
  return { learning: createSampleLearning({ id, status: MemoryStatus.APPROVED }), similarity };
}

Deno.test("findDedupMatch: similarity exactly at threshold counts as a match", () => {
  const match = findDedupMatch([candidate("a", 0.92)], 0.92);
  assertEquals(match?.learning.id, "a");
});

Deno.test("findDedupMatch: similarity just below threshold is excluded", () => {
  const match = findDedupMatch([candidate("a", 0.9199999)], 0.92);
  assertEquals(match, undefined);
});

Deno.test("findDedupMatch: returns the strongest match among multiple qualifying candidates", () => {
  const match = findDedupMatch(
    [candidate("weak", 0.93), candidate("strong", 0.98)],
    0.92,
  );
  assertEquals(match?.learning.id, "strong");
});

Deno.test("findDedupMatch: returns undefined when no candidate qualifies", () => {
  assertEquals(findDedupMatch([candidate("a", 0.1)], 0.92), undefined);
});

Deno.test("findDedupMatch: returns undefined for an empty candidate list", () => {
  assertEquals(findDedupMatch([], 0.92), undefined);
});
