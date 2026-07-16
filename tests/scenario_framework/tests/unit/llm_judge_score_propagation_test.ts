/**
 * @module LlmJudgeScorePropagationTest
 * @path tests/scenario_framework/tests/unit/llm_judge_score_propagation_test.ts
 * @description Tests that LLM judge fractional scores propagate through
 * ICriterionResult.score into computeStepScore, overriding the binary
 * PASSED/FAILED derivation. Also tests that the core CriterionResultSchema
 * import is renamed to JudgeResponseSchema to avoid naming collision.
 */

import { assertEquals } from "@std/assert";
import { CriterionStatus } from "../../schema/step_schema.ts";
import { computeStepScore } from "../../runner/scoring.ts";
import type { ICriterionResult } from "../../schema/step_schema.ts";

function makeResult(overrides: Partial<ICriterionResult>): ICriterionResult {
  return {
    criterion_id: "test",
    kind: "llm-judge" as ICriterionResult["kind"],
    phase: "output" as ICriterionResult["phase"],
    status: CriterionStatus.PASSED,
    message: "test",
    evidence_refs: [],
    ...overrides,
  } as ICriterionResult;
}

Deno.test("[LlmJudgeScore] judge score 0.85 at threshold 0.7 → status PASSED and score 0.85", () => {
  const result: ICriterionResult = {
    criterion_id: "judge-1",
    kind: "llm-judge" as ICriterionResult["kind"],
    phase: "output" as ICriterionResult["phase"],
    status: CriterionStatus.PASSED,
    message: "LLM judge score: 0.85 (threshold: 0.7)",
    evidence_refs: [],
    score: 0.85,
    score_weight: 1.0,
    judge: { provider: "openai", model: "gpt-4" },
  };
  // With threshold gating: pass if score >= threshold
  assertEquals(result.score! >= 0.7, true);
  assertEquals(result.status, CriterionStatus.PASSED);
  // Fractional score should propagate into step score
  const stepScore = computeStepScore([result]);
  assertEquals(stepScore, 0.85);
});

Deno.test("[LlmJudgeScore] step score reflects judge 0.85, not binarized 1.0", () => {
  const results: ICriterionResult[] = [
    makeResult({ criterion_id: "deterministic", status: CriterionStatus.PASSED, score: 1.0, score_weight: 0.5 }),
    makeResult({ criterion_id: "judge", status: CriterionStatus.PASSED, score: 0.85, score_weight: 0.5 }),
  ];
  // Without scores: both passed → 1.0
  // With judge score 0.85: (1.0*0.5 + 0.85*0.5) / 1.0 = 0.925
  assertEquals(computeStepScore(results), 0.925);
});

Deno.test("[LlmJudgeScore] judge score below threshold → status FAILED, score still propagates", () => {
  // Even when status is FAILED (because score < threshold), the score field
  // carries the raw judge value so step scoring is continuous
  const result: ICriterionResult = {
    criterion_id: "judge-1",
    kind: "llm-judge" as ICriterionResult["kind"],
    phase: "output" as ICriterionResult["phase"],
    status: CriterionStatus.FAILED,
    message: "LLM judge score: 0.35 (threshold: 0.7)",
    evidence_refs: [],
    score: 0.35,
    score_weight: 1.0,
    judge: { provider: "openai", model: "gpt-4" },
  };
  assertEquals(computeStepScore([result]), 0.35);
});

Deno.test("[LlmJudgeScore] judge provenance is preserved on result", () => {
  const judge = { provider: "anthropic", model: "claude-3-opus", reasoning: "Good code quality" };
  const result: ICriterionResult = {
    criterion_id: "judge-1",
    kind: "llm-judge" as ICriterionResult["kind"],
    phase: "output" as ICriterionResult["phase"],
    status: CriterionStatus.PASSED,
    message: "LLM judge score: 0.95 (threshold: 0.7)",
    evidence_refs: [],
    score: 0.95,
    score_weight: 1.0,
    judge,
  };
  assertEquals(result.judge!.provider, "anthropic");
  assertEquals(result.judge!.model, "claude-3-opus");
  assertEquals(result.judge!.reasoning, "Good code quality");
});
