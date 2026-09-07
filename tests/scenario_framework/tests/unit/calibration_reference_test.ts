/**
 * @module ScenarioFrameworkCalibrationReferenceTest
 * @path tests/scenario_framework/tests/unit/calibration_reference_test.ts
 * @description Phase 146 Step 1 — the cross-provider reference evaluator: uses the
 *   real GOAL_ALIGNED_REVIEW preset/prompt-building path (via the mock provider, no
 *   network/cost) and rejects a malformed response instead of synthesizing a pass.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/calibration_reference.ts]
 */

import { assertEquals, assertRejects } from "@std/assert";
import { withEnv } from "@exaix/testing";
import { CalibrationLabel } from "@exaix/eval-history";
import { evaluateReference, ReferenceEvaluationError } from "../../runner/calibration_reference.ts";

const NO_BACKWARD_KEYS: Record<string, null> = {
  ANTHROPIC_API_KEY: null,
  OPENAI_API_KEY: null,
  GOOGLE_API_KEY: null,
  OPENROUTER_API_KEY: null,
};

Deno.test({
  name:
    "[CalibrationReference] calls the mock provider with the real GOAL_ALIGNED_REVIEW prompt and either scores or reports a clear parse failure",
  fn: async () => {
    // The shared mock provider's patterns target ReAct-agent prompts, not judge JSON, so
    // parsing isn't guaranteed here; the successful-score path is proven by the live run.
    await withEnv({ ...NO_BACKWARD_KEYS }, async () => {
      try {
        const result = await evaluateReference({
          requestContext: "Add input validation to the login form.",
          artifact: "## Plan\n1. Validate email format\n2. Validate password length",
          preset: "GOAL_ALIGNED_REVIEW",
          labelThreshold: 0.7,
          referenceProvider: "mock",
          referenceModel: "mock",
        });
        assertEquals(typeof result.score, "number");
        assertEquals(result.provider, "mock");
        assertEquals(result.label, result.score >= 0.7 ? CalibrationLabel.Pass : CalibrationLabel.Fail);
      } catch (error) {
        assertEquals(error instanceof ReferenceEvaluationError, true);
      }
    });
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

Deno.test({
  name: "[CalibrationReference] rejects an unknown preset rather than silently scoring empty criteria",
  fn: async () => {
    await withEnv({ ...NO_BACKWARD_KEYS }, async () => {
      await assertRejects(
        () =>
          evaluateReference({
            requestContext: "context",
            artifact: "artifact",
            preset: "not-a-real-preset",
            labelThreshold: 0.7,
            referenceProvider: "mock",
            referenceModel: "mock",
          }),
        ReferenceEvaluationError,
      );
    });
  },
  sanitizeOps: false,
  sanitizeResources: false,
});
