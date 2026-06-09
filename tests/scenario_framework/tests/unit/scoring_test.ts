/**
 * @module ScenarioFrameworkScoringTest
 * @path tests/scenario_framework/tests/unit/scoring_test.ts
 * @description RED-first tests for Step 1 scoring extension. Verifies
 * computeStepScore and computeSuiteScore with weighted and unweighted criteria.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/scoring.ts, tests/scenario_framework/runner/assertions.ts, tests/scenario_framework/schema/step_schema.ts]
 */

import { assertEquals } from "@std/assert";
import { CriterionStatus } from "../../schema/step_schema.ts";
import { computeStepScore, computeSuiteScore } from "../../runner/scoring.ts";
import type { ICriterionResult, IScenarioStep } from "../../schema/step_schema.ts";

function makeResult(overrides: Partial<ICriterionResult>): ICriterionResult {
  return {
    criterion_id: "test",
    kind: "file-exists" as ICriterionResult["kind"],
    phase: "output" as ICriterionResult["phase"],
    status: CriterionStatus.PASSED,
    message: "test",
    evidence_refs: [],
    ...overrides,
  };
}

const DUMMY_STEP: IScenarioStep = {
  id: "step-1",
  type: "shell" as IScenarioStep["type"],
  command: "echo",
  continue_on_failure: false,
  input_criteria: [],
  output_criteria: [],
};

Deno.test("[Scoring] computeStepScore — all criteria pass returns 1.0", () => {
  const results: ICriterionResult[] = [
    makeResult({ criterion_id: "a", status: CriterionStatus.PASSED }),
    makeResult({ criterion_id: "b", status: CriterionStatus.PASSED }),
  ];
  const score = computeStepScore(results);
  assertEquals(score, 1.0);
});

Deno.test("[Scoring] computeStepScore — all criteria fail returns 0.0", () => {
  const results: ICriterionResult[] = [
    makeResult({ criterion_id: "a", status: CriterionStatus.FAILED }),
    makeResult({ criterion_id: "b", status: CriterionStatus.FAILED }),
  ];
  const score = computeStepScore(results);
  assertEquals(score, 0.0);
});

Deno.test("[Scoring] computeStepScore — mixed pass/fail with equal weights returns 0.5", () => {
  const results: ICriterionResult[] = [
    makeResult({ criterion_id: "a", status: CriterionStatus.PASSED }),
    makeResult({ criterion_id: "b", status: CriterionStatus.FAILED }),
  ];
  const score = computeStepScore(results);
  assertEquals(score, 0.5);
});

Deno.test("[Scoring] computeStepScore — weighted: 0.7 weight passes, 0.3 fails = 0.7", () => {
  const results: ICriterionResult[] = [
    makeResult({ criterion_id: "a", status: CriterionStatus.PASSED, score_weight: 0.7 }),
    makeResult({ criterion_id: "b", status: CriterionStatus.FAILED, score_weight: 0.3 }),
  ];
  const score = computeStepScore(results);
  assertEquals(score, 0.7);
});

Deno.test("[Scoring] computeStepScore — empty results returns 1.0", () => {
  const score = computeStepScore([]);
  assertEquals(score, 1.0);
});

Deno.test("[Scoring] computeStepScore — no score_weight on any criterion defaults to equal weights", () => {
  const results: ICriterionResult[] = [
    makeResult({ criterion_id: "a", status: CriterionStatus.PASSED }),
    makeResult({ criterion_id: "b", status: CriterionStatus.FAILED }),
    makeResult({ criterion_id: "c", status: CriterionStatus.PASSED }),
  ];
  const score = computeStepScore(results);
  assertEquals(score, 2 / 3);
});

Deno.test("[Scoring] computeSuiteScore — all steps pass returns 1.0", () => {
  const stepOutcomes = [
    { stepId: "s1", score: 1.0, step: { ...DUMMY_STEP, id: "s1" } },
    { stepId: "s2", score: 1.0, step: { ...DUMMY_STEP, id: "s2" } },
  ];
  const score = computeSuiteScore(stepOutcomes);
  assertEquals(score, 1.0);
});

Deno.test("[Scoring] computeSuiteScore — weighted steps: step_weight 0.8 passes, 0.2 fails = 0.8", () => {
  const stepOutcomes = [
    { stepId: "s1", score: 1.0, step: { ...DUMMY_STEP, id: "s1", step_weight: 0.8 } },
    { stepId: "s2", score: 0.0, step: { ...DUMMY_STEP, id: "s2", step_weight: 0.2 } },
  ];
  const score = computeSuiteScore(stepOutcomes);
  assertEquals(score, 0.8);
});

Deno.test("[Scoring] computeSuiteScore — no step_weights defaults to equal weights", () => {
  const stepOutcomes = [
    { stepId: "s1", score: 1.0, step: { ...DUMMY_STEP, id: "s1" } },
    { stepId: "s2", score: 0.0, step: { ...DUMMY_STEP, id: "s2" } },
    { stepId: "s3", score: 0.5, step: { ...DUMMY_STEP, id: "s3" } },
  ];
  const score = computeSuiteScore(stepOutcomes);
  assertEquals(score, (1.0 + 0.0 + 0.5) / 3);
});
