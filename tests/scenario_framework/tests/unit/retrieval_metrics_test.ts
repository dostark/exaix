/**
 * @module RetrievalMetricsTest
 * @path tests/scenario_framework/tests/unit/retrieval_metrics_test.ts
 * @description RED-first tests for Phase 148 Step 2's `computePrecisionAtK`,
 * `computeReciprocalRank` (the `mrr` metric family), and `computeNdcgAtK` (graded
 * relevance) — pure retrieval-quality functions scored over (retrieved ids,
 * ground-truth ids/relevance) with no provider/LLM involvement.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/retrieval_metrics.ts]
 */

import { assertEquals } from "@std/assert";
import { computeNdcgAtK, computePrecisionAtK, computeReciprocalRank } from "../../runner/retrieval_metrics.ts";

Deno.test("[PrecisionAtK] perfect precision — every top-k slot is relevant", () => {
  assertEquals(computePrecisionAtK(["a", "b"], ["a", "b"], 2), 1.0);
});

Deno.test("[PrecisionAtK] partial precision — half the top-k slots are relevant", () => {
  assertEquals(computePrecisionAtK(["a", "x"], ["a", "b"], 2), 0.5);
});

Deno.test("[PrecisionAtK] miss — none of the top-k slots are relevant", () => {
  assertEquals(computePrecisionAtK(["x", "y"], ["a", "b"], 2), 0);
});

Deno.test("[PrecisionAtK] k smaller than retrieved list only scores the top-k slots", () => {
  assertEquals(computePrecisionAtK(["a", "x", "y"], ["a"], 1), 1.0);
});

Deno.test("[PrecisionAtK] retrieved list shorter than k divides by k, not the retrieved count", () => {
  assertEquals(computePrecisionAtK(["a"], ["a", "b"], 5), 0.2);
});

Deno.test("[ReciprocalRank] first retrieved item is relevant — rank 1 scores 1.0", () => {
  assertEquals(computeReciprocalRank(["a", "x"], ["a"]), 1.0);
});

Deno.test("[ReciprocalRank] second retrieved item is the first relevant one — scores 0.5", () => {
  assertEquals(computeReciprocalRank(["x", "a"], ["a"]), 0.5);
});

Deno.test("[ReciprocalRank] third retrieved item is the first relevant one — scores ~0.333", () => {
  assertEquals(computeReciprocalRank(["x", "y", "a"], ["a"]), 1 / 3);
});

Deno.test("[ReciprocalRank] no relevant item retrieved at all scores 0", () => {
  assertEquals(computeReciprocalRank(["x", "y"], ["a"]), 0);
});

Deno.test("[ReciprocalRank] uses the FIRST relevant hit, not any later one", () => {
  assertEquals(computeReciprocalRank(["x", "a", "b"], ["a", "b"]), 0.5);
});

Deno.test("[NdcgAtK] perfect ranking (highest relevance first) scores 1.0", () => {
  const score = computeNdcgAtK(["a", "b", "c"], { a: 3, b: 2, c: 1 }, 3);
  assertEquals(score, 1.0);
});

Deno.test("[NdcgAtK] reversed ranking (lowest relevance first) scores below 1.0", () => {
  const score = computeNdcgAtK(["c", "b", "a"], { a: 3, b: 2, c: 1 }, 3);
  assertEquals(score < 1.0, true);
  assertEquals(score > 0, true);
});

Deno.test("[NdcgAtK] no relevant items retrieved scores 0", () => {
  const score = computeNdcgAtK(["x", "y"], { a: 3, b: 2 }, 2);
  assertEquals(score, 0);
});

Deno.test("[NdcgAtK] an id absent from the relevance map counts as relevance 0", () => {
  const score = computeNdcgAtK(["a", "unknown"], { a: 1 }, 2);
  // Ideal DCG@2 with only one relevant item (relevance 1) at rank 1: (2^1-1)/log2(2) = 1.
  // Actual DCG@2: same ranking (a first) achieves the same ideal ordering.
  assertEquals(score, 1.0);
});

Deno.test("[NdcgAtK] all-zero relevance (empty relevance map) scores 0, not NaN", () => {
  const score = computeNdcgAtK(["x", "y"], {}, 2);
  assertEquals(score, 0);
});

Deno.test("[NdcgAtK] k truncates the retrieved list before scoring", () => {
  // Only rank 1 ("c", irrelevant) is considered under k=1; the relevant items beyond it don't count.
  const score = computeNdcgAtK(["c", "a"], { a: 3 }, 1);
  assertEquals(score, 0);
});
