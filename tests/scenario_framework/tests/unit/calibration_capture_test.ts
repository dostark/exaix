/**
 * @module ScenarioFrameworkCalibrationCaptureTest
 * @path tests/scenario_framework/tests/unit/calibration_capture_test.ts
 * @description The calibration capture hook: `callLlmEndpoint`'s
 *   `onResolved` observer sees the actual resolved provider/model/result, and
 *   `evaluateLlmJudgeCriterion` invokes `options.calibrationCapture` with the raw
 *   evaluation inputs only on a real (non-mock) call, before scoring — never on the
 *   SKIPPED or mock-pass paths, and never with the target's own score/verdict.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/assertions.ts]
 */

import { assertEquals, assertExists, assertStringIncludes } from "@std/assert";
import { withEnv } from "@exaix/testing";
import {
  callLlmEndpoint,
  evaluateLlmJudgeCriterion,
  type ICalibrationCaptureMetadata,
  type IEvaluateCriterionOptions,
  type ILlmEndpointResolvedMetadata,
} from "../../runner/assertions.ts";
import { CriterionKind, CriterionPhase } from "../../schema/step_schema.ts";

const NO_BACKWARD_KEYS: Record<string, null> = {
  ANTHROPIC_API_KEY: null,
  OPENAI_API_KEY: null,
  GOOGLE_API_KEY: null,
  OPENROUTER_API_KEY: null,
};

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
  name: "[CalibrationCapture] callLlmEndpoint's onResolved observer sees the real resolved provider/model/result",
  fn: async () => {
    await withEnv({ EXA_LLM_PROVIDER: "mock", ...NO_BACKWARD_KEYS }, async () => {
      let observed: ILlmEndpointResolvedMetadata | undefined;
      const result = await callLlmEndpoint("test prompt", undefined, undefined, (metadata) => {
        observed = metadata;
      });

      assertEquals(typeof result, "string");
      assertExists(observed);
      assertEquals(observed.provider, "mock");
      assertExists(observed.model);
      assertEquals(observed.result.content, result);
    });
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

Deno.test({
  name: "[CalibrationCapture] callLlmEndpoint with no onResolved observer behaves exactly as before",
  fn: async () => {
    await withEnv({ EXA_LLM_PROVIDER: "mock", ...NO_BACKWARD_KEYS }, async () => {
      const result = await callLlmEndpoint("test prompt");
      assertEquals(typeof result, "string");
    });
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

Deno.test({
  name:
    "[CalibrationCapture] evaluateLlmJudgeCriterion invokes calibrationCapture on the real-call path, before scoring",
  fn: async () => {
    await withEnv({ EXA_LLM_PROVIDER: "mock", ...NO_BACKWARD_KEYS }, async () => {
      let captured: ICalibrationCaptureMetadata | undefined;
      await evaluateLlmJudgeCriterion(
        makeOptions({
          env: { EXA_EVAL_LLM_MOCK: "false" },
          calibrationCapture: (metadata) => {
            captured = metadata;
          },
        }),
      );

      assertExists(captured);
      assertEquals(captured.provider, "mock");
      assertExists(captured.model);
      assertExists(captured.promptUsed);
      assertExists(captured.rawResponse);
      assertEquals(typeof captured.requestContext, "string");
      assertEquals(typeof captured.artifact, "string");
      assertEquals(typeof captured.rubricMethodology, "string");

      // The capture metadata never carries a score/verdict — the reference evaluator must
      // stay blind to the target's own judgment.
      assertEquals(Object.hasOwn(captured, "score"), false);
      assertEquals(Object.hasOwn(captured, "passed"), false);
    });
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

Deno.test({
  name: "[CalibrationCapture] evaluateLlmJudgeCriterion does not invoke calibrationCapture on the mock-pass path",
  fn: async () => {
    const prev = Deno.env.get("EXA_EVAL_LLM_MOCK");
    Deno.env.set("EXA_EVAL_LLM_MOCK", "pass");
    try {
      let calls = 0;
      const result = await evaluateLlmJudgeCriterion(
        makeOptions({
          calibrationCapture: () => {
            calls++;
          },
        }),
      );
      assertEquals(calls, 0);
      assertExists(result);
    } finally {
      if (prev !== undefined) Deno.env.set("EXA_EVAL_LLM_MOCK", prev);
      else Deno.env.delete("EXA_EVAL_LLM_MOCK");
    }
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

Deno.test({
  name: "[CalibrationCapture] evaluateLlmJudgeCriterion does not invoke calibrationCapture on the SKIPPED path",
  fn: async () => {
    const prev = Deno.env.get("EXA_EVAL_LLM_MOCK");
    Deno.env.delete("EXA_EVAL_LLM_MOCK");
    try {
      let calls = 0;
      const result = await evaluateLlmJudgeCriterion(
        makeOptions({
          calibrationCapture: () => {
            calls++;
          },
        }),
      );
      assertEquals(calls, 0);
      assertStringIncludes(result.message ?? "", "no LLM configured");
    } finally {
      if (prev !== undefined) Deno.env.set("EXA_EVAL_LLM_MOCK", prev);
    }
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

Deno.test({
  name: "[CalibrationCapture] absent calibrationCapture leaves the real-call path's legacy result schema unchanged",
  fn: async () => {
    await withEnv({ EXA_LLM_PROVIDER: "mock", ...NO_BACKWARD_KEYS }, async () => {
      const result = await evaluateLlmJudgeCriterion(
        makeOptions({ env: { EXA_EVAL_LLM_MOCK: "false" } }),
      );
      assertEquals(result.criterion_id, "test-llm-judge");
      assertEquals(result.kind, CriterionKind.LLM_JUDGE);
      assertExists(result.status);
    });
  },
  sanitizeOps: false,
  sanitizeResources: false,
});
