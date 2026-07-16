/**
 * @module CriterionScoreComposeTest
 * @path tests/scenario_framework/tests/unit/criterion_score_compose_test.ts
 * @description Tests for Step 3 continuous scoring: computeStepScore uses
 * result.score (0-1) when present, SKIPPED criteria excluded from denominator,
 * all-SKIPPED step scores 1.0 (vacuous pass).
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
  } as ICriterionResult;
}

const DUMMY_STEP: IScenarioStep = {
  id: "step-1",
  type: "shell" as IScenarioStep["type"],
  command: "echo",
  continue_on_failure: false,
  input_criteria: [],
  output_criteria: [],
};

Deno.test("[CriterionScoreCompose] fractional scores with equal weights → weighted mean", () => {
  const results: ICriterionResult[] = [
    makeResult({ criterion_id: "a", status: CriterionStatus.PASSED, score: 1.0 }),
    makeResult({ criterion_id: "b", status: CriterionStatus.FAILED, score: 0.5 }),
  ];
  assertEquals(computeStepScore(results), 0.75);
});

Deno.test("[CriterionScoreCompose] result.score absent → derive from status (PASSED=1, FAILED=0)", () => {
  const results: ICriterionResult[] = [
    makeResult({ criterion_id: "a", status: CriterionStatus.PASSED }),
    makeResult({ criterion_id: "b", status: CriterionStatus.FAILED }),
  ];
  assertEquals(computeStepScore(results), 0.5);
});

Deno.test("[CriterionScoreCompose] score overrides status when both present", () => {
  const results: ICriterionResult[] = [
    makeResult({ criterion_id: "a", status: CriterionStatus.FAILED, score: 0.9 }),
    makeResult({ criterion_id: "b", status: CriterionStatus.PASSED, score: 0.3 }),
  ];
  assertEquals(computeStepScore(results), 0.6);
});

Deno.test("[CriterionScoreCompose] SKIPPED criterion excluded from numerator AND denominator", () => {
  const results: ICriterionResult[] = [
    makeResult({ criterion_id: "a", status: CriterionStatus.PASSED, score: 1.0, score_weight: 0.5 }),
    makeResult({ criterion_id: "b", status: CriterionStatus.SKIPPED, score: 0.9, score_weight: 0.5 }),
  ];
  // Only 'a' counts: weight 0.5, totalWeight 0.5, score 1.0
  assertEquals(computeStepScore(results), 1.0);
});

Deno.test("[CriterionScoreCompose] all-SKIPPED step scores 1.0 (vacuous pass)", () => {
  const results: ICriterionResult[] = [
    makeResult({ criterion_id: "a", status: CriterionStatus.SKIPPED }),
    makeResult({ criterion_id: "b", status: CriterionStatus.SKIPPED }),
  ];
  assertEquals(computeStepScore(results), 1.0);
});

Deno.test("[CriterionScoreCompose] mixed SKIPPED with score_weight — SKIPPED excluded from totalWeight", () => {
  const results: ICriterionResult[] = [
    makeResult({ criterion_id: "a", status: CriterionStatus.PASSED, score: 0.8, score_weight: 0.3 }),
    makeResult({ criterion_id: "b", status: CriterionStatus.SKIPPED, score_weight: 0.7 }),
    makeResult({ criterion_id: "c", status: CriterionStatus.FAILED, score: 0.4, score_weight: 0.3 }),
  ];
  // Only a (weight 0.3, score 0.8) and c (weight 0.3, score 0.4)
  // totalWeight = 0.6, weightedSum = 0.8*0.3 + 0.4*0.3 = 0.24+0.12 = 0.36
  assertEquals(computeStepScore(results), 0.36 / 0.6);
});

Deno.test("[CriterionScoreCompose] ERROR and TIMEOUT score 0 regardless of score field", () => {
  const results: ICriterionResult[] = [
    makeResult({ criterion_id: "a", status: CriterionStatus.PASSED, score: 1.0, score_weight: 0.5 }),
    makeResult({ criterion_id: "b", status: CriterionStatus.ERROR, score: 0.8, score_weight: 0.5 }),
  ];
  // ERROR → score 0 regardless of score field
  assertEquals(computeStepScore(results), 0.5);
});

Deno.test("[CriterionScoreCompose] TIMEOUT scores 0", () => {
  const results: ICriterionResult[] = [
    makeResult({ criterion_id: "a", status: CriterionStatus.PASSED, score: 1.0, score_weight: 0.5 }),
    makeResult({ criterion_id: "b", status: CriterionStatus.TIMEOUT, score: 0.9, score_weight: 0.5 }),
  ];
  assertEquals(computeStepScore(results), 0.5);
});

Deno.test("[CriterionScoreCompose] computeSuiteScore unchanged — composes step scores as before", () => {
  const stepOutcomes = [
    { stepId: "s1", score: 0.75, step: { ...DUMMY_STEP, id: "s1", step_weight: 0.6 } },
    { stepId: "s2", score: 0.25, step: { ...DUMMY_STEP, id: "s2", step_weight: 0.4 } },
  ];
  assertEquals(computeSuiteScore(stepOutcomes), 0.75 * 0.6 + 0.25 * 0.4);
});
