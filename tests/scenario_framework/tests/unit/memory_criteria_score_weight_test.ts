/**
 * @module MemoryCriteriaScoreWeightTest
 * @path tests/scenario_framework/tests/unit/memory_criteria_score_weight_test.ts
 * @description Regression coverage for Phase 148 Step 2's `recall-at-k`, `precision-at-k`,
 * `mrr`, `ndcg-at-k`, and `abstention` criterion evaluators: each must propagate the
 * criterion's own `score_weight` into its `ICriterionResult` — `computeStepScore`
 * (scoring.ts) reads `result.score_weight`, not the criterion definition, so an
 * evaluator that omits it silently falls back to a weight of 1.0 regardless of what a
 * scenario YAML declares. Caught live: a real scenario run scored 0.889 instead of the
 * expected weighted result because these five evaluators built their result objects by
 * hand instead of via the shared `buildPassedResult`/`buildFailedResult` convention.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/assertions.ts, tests/scenario_framework/runner/scoring.ts]
 */

import { assertEquals } from "@std/assert";
import { evaluateCriterion } from "../../runner/assertions.ts";
import { CriterionKind, CriterionPhase, ScenarioStepType } from "../../schema/step_schema.ts";
import type { ICriterion } from "../../schema/step_schema.ts";

const RETRIEVED_ID = "aaaaaaaa-0000-4000-8000-000000000001";
const STDOUT = JSON.stringify({ retrieved_ids: [RETRIEVED_ID] });

const CRITERIA: Array<{ name: string; criterion: ICriterion }> = [
  {
    name: "recall-at-k",
    criterion: { id: "c", kind: CriterionKind.RECALL_AT_K, k: 1, ground_truth_ids: [RETRIEVED_ID], score_weight: 0.3 },
  },
  {
    name: "precision-at-k",
    criterion: {
      id: "c",
      kind: CriterionKind.PRECISION_AT_K,
      k: 1,
      ground_truth_ids: [RETRIEVED_ID],
      score_weight: 0.3,
    },
  },
  {
    name: "mrr",
    criterion: { id: "c", kind: CriterionKind.MRR, ground_truth_ids: [RETRIEVED_ID], score_weight: 0.3 },
  },
  {
    name: "ndcg-at-k",
    criterion: {
      id: "c",
      kind: CriterionKind.NDCG_AT_K,
      k: 1,
      ground_truth_relevance: { [RETRIEVED_ID]: 1 },
      score_weight: 0.3,
    },
  },
  {
    name: "abstention",
    criterion: { id: "c", kind: CriterionKind.ABSTENTION, score_weight: 0.3 },
  },
];

for (const { name, criterion } of CRITERIA) {
  Deno.test(`[MemoryCriteriaScoreWeight] ${name} propagates the criterion's score_weight into the result`, async () => {
    const result = await evaluateCriterion({
      workspaceRoot: await Deno.makeTempDir(),
      phase: CriterionPhase.OUTPUT,
      criterion,
      executionResult: {
        stepId: "s",
        stepType: ScenarioStepType.RUN_SCRIPT,
        startedAt: "",
        completedAt: "",
        durationMs: 0,
        exitCode: 0,
        stdout: STDOUT,
        stderr: "",
        combinedOutput: STDOUT,
      },
    });
    assertEquals(result.score_weight, 0.3);
  });
}
