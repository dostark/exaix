/**
 * @module PersonaResponseJudgeTest
 * @path tests/scenario_framework/tests/unit/persona_response_judge_test.ts
 * @description Verifies rubric grounding and observed judge identity on the endpoint path.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/assertions.ts]
 */
import { assertEquals, assertStringIncludes } from "@std/assert";
import { withEnv } from "@exaix/testing";
import { join } from "@std/path";
import { stub } from "@std/testing/mock";
import { MockProvider } from "@exaix/ai/providers.ts";
import { ProviderFactory } from "@exaix/ai/provider_factory.ts";
import { evaluateLlmJudgeCriterion } from "../../runner/assertions.ts";
import { CriterionKind, CriterionPhase, CriterionStatus } from "../../schema/step_schema.ts";

Deno.test({
  name: "[PersonaResponse] actual judge call receives role rubric alongside frozen task/source context",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const root = await Deno.makeTempDir({ prefix: "persona-judge-" });
    try {
      await Deno.writeTextFile(join(root, "context.txt"), "Frozen original source and task");
      await Deno.writeTextFile(join(root, "response.txt"), "Actual response");
      await withEnv({
        EXA_LLM_PROVIDER: "mock",
        EXA_LLM_MODEL: "mock:mock",
        ANTHROPIC_API_KEY: null,
        OPENAI_API_KEY: null,
        GOOGLE_API_KEY: null,
        OPENROUTER_API_KEY: null,
      }, async () => {
        using _factory = stub(
          ProviderFactory,
          "createByName",
          () =>
            Promise.resolve(
              new MockProvider(
                '{"score":0,"reasoning":"weak response"}',
              ),
            ),
        );
        const result = await evaluateLlmJudgeCriterion({
          workspaceRoot: root,
          phase: CriterionPhase.OUTPUT,
          env: { EXA_EVAL_LLM_MOCK: "false" },
          criterion: {
            id: "persona-response-quality",
            kind: CriterionKind.LLM_JUDGE,
            rubric: "Distinguish proposed work from executed work",
            evidence_path: "response.txt",
            context_path: "context.txt",
            score_threshold: 0.5,
          },
          calibrationCapture: (metadata) => {
            assertStringIncludes(metadata.promptUsed, "Distinguish proposed work from executed work");
            assertStringIncludes(metadata.promptUsed, "Frozen original source and task");
            assertStringIncludes(metadata.promptUsed, "Actual response");
          },
        });
        assertEquals(result.status, CriterionStatus.FAILED);
        assertEquals(result.score, 0);
        assertEquals(result.judge?.model, "mock");
      });
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  },
});
