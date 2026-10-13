/**
 * @module OpenRouterStructuredOutputLiveTest
 * @path tests/integration/openrouter_structured_output_live_test.ts
 * @description Verifies live request analysis and one Responses API probe on the planned OpenRouter models.
 * @architectural-layer Integration
 * @dependencies [@exaix/request, @exaix/ai-openrouter]
 * @related-files [tests/integration/helpers/openrouter_live_matrix.ts]
 */
import { assert, assertEquals } from "@std/assert";
import { AnalysisMode } from "@exaix/core/types";
import {
  liveMatrixEnabled,
  MATRIX_MODELS,
  runLiveAnalysis,
  runResponsesProbe,
} from "./helpers/openrouter_live_matrix.ts";

for (const model of MATRIX_MODELS) {
  Deno.test({
    name: `[live][openrouter][phase211] request analysis returns a schema-valid analysis on ${model}`,
    ignore: !liveMatrixEnabled(),
    sanitizeOps: false,
    sanitizeResources: false,
    async fn() {
      const result = await runLiveAnalysis(model);
      assertEquals(result.analysis.metadata.mode, AnalysisMode.LLM, "request analysis used its fallback");
      assert(result.validCore, "the analysis does not satisfy the core schema");
      assert(result.analysis.goals.length > 0, "the analyzer returned its empty fallback goals");
      assert(result.analysis.actionabilityScore > 0, "the analyzer returned its zero-score fallback");
      assertEquals(
        result.calls.filter((call) => call.status === 200).length,
        2,
        "analysis and refine must both finish",
      );
      assert(
        result.calls.filter((call) => call.status === 200).every((call) => call.finishReason === "stop"),
        "a completion was cut off",
      );
    },
  });
}

Deno.test({
  name: "[live][openrouter][phase211] Responses API probe returns a completion on qwen/qwen3.7-flash",
  ignore: !liveMatrixEnabled(),
  async fn() {
    const probe = await runResponsesProbe();
    assertEquals(probe.status, 200);
    assertEquals(probe.completed, true);
    assert(probe.outputChars > 0, "the Responses probe returned no output text");
  },
});
