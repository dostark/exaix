/**
 * @module LlmJudgeProvenanceTest
 * @path tests/scenario_framework/tests/unit/llm_judge_provenance_test.ts
 * @description Tests that judge provenance (provider, model, reasoning)
 * is carried on ICriterionResult and round-trips through JSON serialization.
 */

import { assertEquals } from "@std/assert";
import { CriterionKind, CriterionResultSchema, CriterionStatus } from "../../schema/step_schema.ts";

Deno.test("[LlmJudgeProvenance] result carries judge.provider and judge.model", () => {
  const result = CriterionResultSchema.parse({
    criterion_id: "judge-1",
    kind: CriterionKind.LLM_JUDGE,
    phase: "output",
    status: CriterionStatus.PASSED,
    message: "LLM judge score: 0.85 (threshold: 0.7)",
    evidence_refs: [],
    score: 0.85,
    score_weight: 1.0,
    judge: { provider: "openai", model: "gpt-4" },
  });
  assertEquals(result.judge!.provider, "openai");
  assertEquals(result.judge!.model, "gpt-4");
});

Deno.test("[LlmJudgeProvenance] judge provenance round-trips through JSON", () => {
  const original = CriterionResultSchema.parse({
    criterion_id: "judge-2",
    kind: CriterionKind.LLM_JUDGE,
    phase: "output",
    status: CriterionStatus.FAILED,
    message: "LLM judge score: 0.35 (threshold: 0.7)",
    evidence_refs: [],
    score: 0.35,
    score_weight: 1.0,
    judge: { provider: "anthropic", model: "claude-3-opus", reasoning: "Failed security check" },
  });
  const json = JSON.stringify(original);
  const parsed = JSON.parse(json);
  const restored = CriterionResultSchema.parse(parsed);
  assertEquals(restored.judge!.provider, "anthropic");
  assertEquals(restored.judge!.model, "claude-3-opus");
  assertEquals(restored.judge!.reasoning, "Failed security check");
});

Deno.test("[LlmJudgeProvenance] judge reasoning is optional", () => {
  const result = CriterionResultSchema.parse({
    criterion_id: "judge-3",
    kind: CriterionKind.LLM_JUDGE,
    phase: "output",
    status: CriterionStatus.PASSED,
    message: "LLM judge score: 0.95 (threshold: 0.7)",
    evidence_refs: [],
    score: 0.95,
    score_weight: 1.0,
    judge: { provider: "google", model: "gemini-pro" },
  });
  assertEquals(result.judge!.provider, "google");
  assertEquals(result.judge!.model, "gemini-pro");
  assertEquals(result.judge!.reasoning, undefined);
});

Deno.test("[LlmJudgeProvenance] non-LLM-judge criteria have no judge field", () => {
  const result = CriterionResultSchema.parse({
    criterion_id: "file-1",
    kind: CriterionKind.FILE_EXISTS,
    phase: "output",
    status: CriterionStatus.PASSED,
    message: "File exists",
    evidence_refs: [],
  });
  assertEquals(result.judge, undefined);
});
