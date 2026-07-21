/**
 * @module LlmJudgeSkipDefaultTest
 * @path tests/scenario_framework/tests/unit/llm_judge_skip_default_test.ts
 * @description Tests that unconfigured LLM judge returns SKIPPED (not PASSED),
 * and that SKIPPED results are excluded from step score computation.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { CriterionKind, CriterionPhase, CriterionStatus } from "../../schema/step_schema.ts";
import {
  evaluateLlmJudgeCriterion,
  resolveEvalJudgeContext,
  resolveEvalLlmTimeoutMs,
} from "../../runner/assertions.ts";
import type { IEvaluateCriterionOptions } from "../../runner/assertions.ts";
import { computeStepScore } from "../../runner/scoring.ts";
import { DEFAULT_CLI_DELEGATE_TIMEOUT_MS } from "@exaix/ai-clidelegate";
import { ProviderType } from "@exaix/core";

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
  name:
    "[LlmJudgeSkip] resolveEvalLlmTimeoutMs gives claude-cli/opencode-cli providers the CLI-appropriate timeout, not the generic 30s AI default",
  fn: () => {
    // Live-observed: the eval-judge's real-LLM path builds its provider via the generic
    // ProviderFactory.resolveOptionsByName, which defaults timeoutMs to DEFAULT_AI_TIMEOUT_MS
    // (30000ms) unless EXA_LLM_TIMEOUT_MS/config.ai_timeout says otherwise — sized for fast
    // HTTP API calls, not a headless CLI subprocess spawn. A real opencode judge call timed
    // out at exactly 30000ms even though CliDelegateProviderFactory's own default is 300000ms
    // (DEFAULT_CLI_DELEGATE_TIMEOUT_MS), because CliDelegateProviderFactory.create() prefers
    // options.timeoutMs when it is set (`options.timeoutMs ?? DEFAULT_CLI_DELEGATE_TIMEOUT_MS`)
    // — and the generic factory always sets it, to 30000, before CliDelegateProviderFactory
    // ever gets a chance to apply its own larger default.
    assertEquals(resolveEvalLlmTimeoutMs(ProviderType.CLAUDE_CLI), DEFAULT_CLI_DELEGATE_TIMEOUT_MS);
    assertEquals(resolveEvalLlmTimeoutMs(ProviderType.OPENCODE_CLI), DEFAULT_CLI_DELEGATE_TIMEOUT_MS);
    // Non-CLI-delegate providers are untouched — no override needed, undefined lets
    // ProviderFactory's own generic 30s default apply as before.
    assertEquals(resolveEvalLlmTimeoutMs(ProviderType.ANTHROPIC), undefined);
    assertEquals(resolveEvalLlmTimeoutMs(ProviderType.OPENAI), undefined);
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

Deno.test({
  name:
    "[LlmJudgeSkip] resolveEvalJudgeContext reads context_path so goal_alignment/task_fulfillment/request_understanding criteria know the actual task",
  fn: async () => {
    // Live-observed bug: buildEvaluationPrompt(content, criteria, context, multi)'s `context`
    // slot was always fed `criterion.rubric` — never populated for preset-based criteria
    // (GOAL_ALIGNED_REVIEW has no rubric) — so the judge saw a bare code file with ZERO
    // information about what the original task/request was, while being asked to score
    // "goal_alignment" (does it accomplish the stated objective) and
    // "request_understanding" (correct understanding of the task). A real run scored those
    // two criteria 0.35/0.50 despite code_correctness scoring 0.90 — exactly the pattern of a
    // judge guessing at criteria it structurally cannot answer without the request text.
    const tempDir = await Deno.makeTempDir();
    try {
      const requestPath = "request.md";
      await Deno.writeTextFile(
        join(tempDir, requestPath),
        "Fix the null-safety bug in formatAssignee.",
      );

      // No context_path set — falls back to rubric (backward-compat), which is undefined here.
      const withoutContext = await resolveEvalJudgeContext({
        workspaceRoot: tempDir,
        rubric: undefined,
        contextPath: undefined,
      });
      assertEquals(withoutContext, undefined);

      // context_path set — reads the real request file content as context.
      const withContext = await resolveEvalJudgeContext({
        workspaceRoot: tempDir,
        rubric: undefined,
        contextPath: requestPath,
      });
      assertStringIncludes(withContext ?? "", "Fix the null-safety bug in formatAssignee.");
    } finally {
      await Deno.remove(tempDir, { recursive: true });
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
