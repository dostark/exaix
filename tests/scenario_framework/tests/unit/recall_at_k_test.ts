/**
 * @module RecallAtKTest
 * @path tests/scenario_framework/tests/unit/recall_at_k_test.ts
 * @description RED-first tests for Phase 148 Step 1's `computeRecallAtK` — the pure
 * recall@k retrieval-quality metric scored over (retrieved ids, ground-truth ids) with
 * no provider/LLM involvement. Exact on textbook cases: perfect, partial, miss.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/retrieval_metrics.ts]
 */

import { assertEquals, assertThrows } from "@std/assert";
import { computeRecallAtK } from "../../runner/retrieval_metrics.ts";

Deno.test("[RecallAtK] perfect recall — every ground-truth id present in top-k", () => {
  const score = computeRecallAtK(["a", "b", "c"], ["a", "b"], 3);
  assertEquals(score, 1.0);
});

Deno.test("[RecallAtK] partial recall — only some ground-truth ids present in top-k", () => {
  const score = computeRecallAtK(["a", "x", "y"], ["a", "b"], 3);
  assertEquals(score, 0.5);
});

Deno.test("[RecallAtK] miss — no ground-truth id present in top-k", () => {
  const score = computeRecallAtK(["x", "y", "z"], ["a", "b"], 3);
  assertEquals(score, 0);
});

Deno.test("[RecallAtK] k truncates the retrieved list before scoring", () => {
  // "a" is retrieved but ranked second; k=1 only looks at the top-1 slot, missing it.
  const score = computeRecallAtK(["z", "a", "b"], ["a", "b"], 1);
  assertEquals(score, 0);
});

Deno.test("[RecallAtK] k larger than the retrieved list still scores correctly", () => {
  const score = computeRecallAtK(["a"], ["a", "b"], 10);
  assertEquals(score, 0.5);
});

Deno.test("[RecallAtK] empty retrieved list scores 0", () => {
  const score = computeRecallAtK([], ["a", "b"], 5);
  assertEquals(score, 0);
});

Deno.test("[RecallAtK] throws on empty ground-truth ids — recall is undefined with no relevant set", () => {
  assertThrows(
    () => computeRecallAtK(["a", "b"], [], 5),
    Error,
    "ground-truth",
  );
});
