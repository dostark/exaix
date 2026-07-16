/**
 * @module LlmJudgePresetSetTest
 * @path tests/scenario_framework/tests/unit/llm_judge_preset_set_test.ts
 * @description Tests CRITERION_SETS preset resolution, weighted score
 * composition via calculateWeightedScore, and EvaluationResultSchema parsing.
 */

import { assertEquals } from "@std/assert";
import {
  calculateWeightedScore,
  type CriterionResult,
  EvaluationResultSchema,
  resolveCriterionPreset,
} from "@exaix/core/evaluation";

Deno.test("[LlmJudgePreset] CODE_REVIEW preset resolves 5 criteria", () => {
  const criteria = resolveCriterionPreset("CODE_REVIEW");
  assertEquals(criteria.length, 5);
  assertEquals(criteria[0].name, "code_correctness");
  assertEquals(criteria[2].name, "follows_conventions");
});

Deno.test("[LlmJudgePreset] GOAL_ALIGNED_REVIEW preset resolves 5 criteria", () => {
  const criteria = resolveCriterionPreset("GOAL_ALIGNED_REVIEW");
  assertEquals(criteria.length, 5);
  assertEquals(criteria[0].name, "goal_alignment");
});

Deno.test("[LlmJudgePreset] single criterion name resolves to one criterion", () => {
  const criteria = resolveCriterionPreset("code_correctness");
  assertEquals(criteria.length, 1);
  assertEquals(criteria[0].name, "code_correctness");
});

Deno.test("[LlmJudgePreset] unknown preset returns empty array", () => {
  const criteria = resolveCriterionPreset("non_existent_preset");
  assertEquals(criteria.length, 0);
});

Deno.test("[LlmJudgePreset] weighted score composition with equal scores returns correct average", () => {
  const criteria = resolveCriterionPreset("CODE_REVIEW");
  const criteriaResults: Record<string, CriterionResult> = {};
  for (const c of criteria) {
    criteriaResults[c.name] = { score: 0.8, passed: true, reasoning: "Good", issues: [] };
  }
  const score = calculateWeightedScore(criteriaResults, criteria);
  assertEquals(score, 0.8);
});

Deno.test("[LlmJudgePreset] weighted score composition with varied scores", () => {
  const criteria = resolveCriterionPreset("CODE_REVIEW");
  const criteriaResults: Record<string, CriterionResult> = {
    code_correctness: { score: 1.0, passed: true, reasoning: "Perfect", issues: [] },
    code_completeness: { score: 0.7, passed: true, reasoning: "Mostly complete", issues: ["missing edge case"] },
    follows_conventions: { score: 0.5, passed: false, reasoning: "Inconsistent style", issues: ["naming"] },
    error_handling: { score: 0.0, passed: false, reasoning: "No error handling", issues: ["no try-catch"] },
    no_security_issues: { score: 1.0, passed: true, reasoning: "Secure", issues: [] },
  };
  // weights: code_correctness=2.0(required), code_completeness=1.5(required),
  // follows_conventions=0.8, error_handling=1.0, no_security_issues=2.0(required)
  // totalWeight = 2.0 + 1.5 + 0.8 + 1.0 + 2.0 = 7.3
  // weightedSum = 1.0*2.0 + 0.7*1.5 + 0.5*0.8 + 0.0*1.0 + 1.0*2.0 = 2.0 + 1.05 + 0.4 + 0.0 + 2.0 = 5.45
  // expected = 5.45 / 7.3 ≈ 0.7466
  const score = calculateWeightedScore(criteriaResults, criteria);
  assertEquals(Math.round(score * 10000), Math.round((5.45 / 7.3) * 10000));
});

Deno.test("[LlmJudgePreset] EvaluationResultSchema parses structured multi-criteria response", () => {
  const raw = `{
    "overallScore": 0.82,
    "criteriaScores": {
      "code_correctness": {
        "score": 0.9,
        "reasoning": "Code is syntactically correct",
        "issues": [],
        "passed": true
      },
      "code_completeness": {
        "score": 0.75,
        "reasoning": "Most requirements met",
        "issues": ["missing error documentation"],
        "passed": true
      }
    },
    "pass": true,
    "feedback": "Good overall implementation",
    "suggestions": ["Add more error documentation"]
  }`;
  const parsed = EvaluationResultSchema.parse(JSON.parse(raw));
  assertEquals(parsed.overallScore, 0.82);
  assertEquals(parsed.pass, true);
  assertEquals(parsed.criteriaScores.code_correctness.score, 0.9);
  assertEquals(parsed.criteriaScores.code_completeness.score, 0.75);
  assertEquals(parsed.feedback, "Good overall implementation");
  assertEquals(parsed.suggestions.length, 1);
});
