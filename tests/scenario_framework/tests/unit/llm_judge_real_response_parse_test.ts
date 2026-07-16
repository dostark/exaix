/**
 * @module LlmJudgeRealResponseParseTest
 * @path tests/scenario_framework/tests/unit/llm_judge_real_response_parse_test.ts
 * @description Regression tests for JSON parsing of LLM judge responses,
 * including bare JSON, markdown-fenced JSON, and multi-criteria responses.
 */

import { assertEquals, assertRejects } from "@std/assert";
import { CriterionResultSchema as JudgeResponseSchema } from "@exaix/core/evaluation";
import { EvaluationResultSchema } from "@exaix/core/evaluation";

Deno.test("[LlmJudgeParse] bare JSON response parses correctly", () => {
  const raw = `{"name": "task_fulfillment", "score": 0.85, "reasoning": "Works well", "issues": [], "passed": true}`;
  const cleaned = raw.replace(/^```(?:json)?\s*\n?/m, "").replace(/\n?```\s*$/m, "").trim();
  const parsed = JudgeResponseSchema.parse(JSON.parse(cleaned));
  assertEquals(parsed.score, 0.85);
  assertEquals(parsed.passed, true);
});

Deno.test("[LlmJudgeParse] markdown-fenced JSON response parses correctly", () => {
  const raw =
    '```json\n{"name": "task_fulfillment", "score": 0.75, "reasoning": "Decent", "issues": ["minor"], "passed": true}\n```';
  const cleaned = raw.replace(/^```(?:json)?\s*\n?/m, "").replace(/\n?```\s*$/m, "").trim();
  const parsed = JudgeResponseSchema.parse(JSON.parse(cleaned));
  assertEquals(parsed.score, 0.75);
});

Deno.test("[LlmJudgeParse] fence-only (no json) response parses correctly", () => {
  const raw =
    '```\n{"name": "task_fulfillment", "score": 0.9, "reasoning": "Excellent", "issues": [], "passed": true}\n```';
  const cleaned = raw.replace(/^```(?:json)?\s*\n?/m, "").replace(/\n?```\s*$/m, "").trim();
  const parsed = JudgeResponseSchema.parse(JSON.parse(cleaned));
  assertEquals(parsed.score, 0.9);
});

Deno.test("[LlmJudgeParse] multi-criteria EvaluationResultSchema parses fenced response", () => {
  const raw =
    '```json\n{"overallScore": 0.78, "criteriaScores": {"code_correctness": {"score": 0.9, "reasoning": "Good", "issues": [], "passed": true}}, "pass": true, "feedback": "OK", "suggestions": []}\n```';
  const cleaned = raw.replace(/^```(?:json)?\s*\n?/m, "").replace(/\n?```\s*$/m, "").trim();
  const parsed = EvaluationResultSchema.parse(JSON.parse(cleaned));
  assertEquals(parsed.overallScore, 0.78);
  assertEquals(parsed.criteriaScores.code_correctness.score, 0.9);
});

Deno.test("[LlmJudgeParse] invalid JSON throws", () => {
  const raw = "this is not json";
  const cleaned = raw.replace(/^```(?:json)?\s*\n?/m, "").replace(/\n?```\s*$/m, "").trim();
  assertRejects(() => Promise.resolve().then(() => JudgeResponseSchema.parse(JSON.parse(cleaned))));
});
