/**
 * @module LlmJudgeSkipDefaultTest
 * @path tests/scenario_framework/tests/unit/llm_judge_skip_default_test.ts
 * @description Tests that unconfigured LLM judge returns SKIPPED (not PASSED),
 * and that SKIPPED results are excluded from step score computation.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { CriterionKind, CriterionPhase, CriterionStatus } from "../../schema/step_schema.ts";
import { evaluateLlmJudgeCriterion } from "../../runner/assertions.ts";
import type { IEvaluateCriterionOptions } from "../../runner/assertions.ts";
import { computeStepScore } from "../../runner/scoring.ts";

function makeOptions(overrides?: Partial<IEvaluateCriterionOptions>): IEvaluateCriterionOptions {
  return {
    workspaceRoot: "/tmp",
    phase: CriterionPhase.OUTPUT,
    criterion: {
      id: "test-llm-judge",
      kind: CriterionKind.LLM_JUDGE,
      preset: "task_fulfillment",
      score_threshold: 0.7,
    },
    ...overrides,
  };
}

Deno.test({
  name: "[LlmJudgeSkip] unset EXA_EVAL_LLM_MOCK → SKIPPED with explanatory message",
  fn: async () => {
    const prev = Deno.env.get("EXA_EVAL_LLM_MOCK");
    Deno.env.delete("EXA_EVAL_LLM_MOCK");
    try {
      const result = await evaluateLlmJudgeCriterion(makeOptions());
      assertEquals(result.status, CriterionStatus.SKIPPED);
      assertStringIncludes(result.message!, "no LLM configured");
      assertEquals(result.kind, CriterionKind.LLM_JUDGE);
      assertEquals(result.criterion_id, "test-llm-judge");
    } finally {
      if (prev !== undefined) Deno.env.set("EXA_EVAL_LLM_MOCK", prev);
      else Deno.env.delete("EXA_EVAL_LLM_MOCK");
    }
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

Deno.test({
  name: "[LlmJudgeSkip] SKIPPED result is excluded from step score (denominator exclusion)",
  fn: () => {
    const skipped: Parameters<typeof computeStepScore>[0] = [{
      criterion_id: "judge-1",
      kind: CriterionKind.LLM_JUDGE,
      phase: CriterionPhase.OUTPUT,
      status: CriterionStatus.SKIPPED,
      message: "LLM judge skipped: no LLM configured",
      evidence_refs: [],
      score_weight: 1.0,
    }, {
      criterion_id: "deterministic",
      kind: CriterionKind.COMMAND_EXIT_CODE,
      phase: CriterionPhase.OUTPUT,
      status: CriterionStatus.PASSED,
      message: "passed",
      evidence_refs: [],
      score_weight: 1.0,
    }];
    const stepScore = computeStepScore(skipped);
    assertEquals(stepScore, 1.0);
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

Deno.test({
  name: "[LlmJudgeSkip] EXA_EVAL_LLM_MOCK=false via step env (not process env) reaches the real-LLM path",
  fn: async () => {
    // Regression: the step declares EXA_EVAL_LLM_MOCK as step env (options.env), but
    // callLlmEndpoint used to read only Deno.env — so with the process env unset it silently
    // fell through to the MockLLMProvider. With the step env honored and no EXA_LLM_PROVIDER
    // configured, the real-LLM path must be taken and surface the "provider required" error,
    // NOT quietly mock.
    const prevMock = Deno.env.get("EXA_EVAL_LLM_MOCK");
    const prevProvider = Deno.env.get("EXA_LLM_PROVIDER");
    Deno.env.delete("EXA_EVAL_LLM_MOCK");
    Deno.env.delete("EXA_LLM_PROVIDER");
    try {
      const result = await evaluateLlmJudgeCriterion(
        makeOptions({ env: { EXA_EVAL_LLM_MOCK: "false" } }),
      );
      assertEquals(result.status, CriterionStatus.ERROR);
      assertStringIncludes(result.message!, "EXA_LLM_PROVIDER is required");
    } finally {
      if (prevMock !== undefined) Deno.env.set("EXA_EVAL_LLM_MOCK", prevMock);
      if (prevProvider !== undefined) Deno.env.set("EXA_LLM_PROVIDER", prevProvider);
    }
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

Deno.test({
  name: "[LlmJudgeSkip] EXA_EVAL_LLM_MOCK=pass restores auto-pass",
  fn: async () => {
    const prev = Deno.env.get("EXA_EVAL_LLM_MOCK");
    Deno.env.set("EXA_EVAL_LLM_MOCK", "pass");
    try {
      const result = await evaluateLlmJudgeCriterion(makeOptions());
      assertEquals(result.status, CriterionStatus.PASSED);
    } finally {
      if (prev !== undefined) Deno.env.set("EXA_EVAL_LLM_MOCK", prev);
      else Deno.env.delete("EXA_EVAL_LLM_MOCK");
    }
  },
  sanitizeOps: false,
  sanitizeResources: false,
});
