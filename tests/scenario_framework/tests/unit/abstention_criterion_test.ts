/**
 * @module AbstentionCriterionTest
 * @path tests/scenario_framework/tests/unit/abstention_criterion_test.ts
 * @description RED-first tests for Phase 148 Step 2's `computeAbstentionCorrect` — the
 * pure function scoring whether the system correctly declined (no memory returned) when
 * no relevant memory exists. Fabricating a memory (returning anything) scores 0.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/retrieval_metrics.ts, tests/scenario_framework/schema/step_schema.ts, tests/scenario_framework/runner/assertions.ts]
 */

import { assertEquals } from "@std/assert";
import { computeAbstentionCorrect } from "../../runner/retrieval_metrics.ts";

Deno.test("[AbstentionCorrect] declining (empty retrieval) when nothing is relevant scores 1", () => {
  assertEquals(computeAbstentionCorrect([]), 1);
});

Deno.test("[AbstentionCorrect] fabricating a single memory scores 0", () => {
  assertEquals(computeAbstentionCorrect(["some-id"]), 0);
});

Deno.test("[AbstentionCorrect] fabricating multiple memories still scores 0, not partial credit", () => {
  assertEquals(computeAbstentionCorrect(["id-1", "id-2", "id-3"]), 0);
});
