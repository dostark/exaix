/**
 * @module ScenarioFrameworkCalibrationReferenceSecurityTest
 * @path tests/scenario_framework/tests/unit/calibration_reference_security_test.ts
 * @description Phase 146 Step 1 security slice — the cross-provider reference evaluator
 *   rejects an unrecognized referenceProvider instead of silently resolving to a
 *   substitute provider.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/calibration_reference.ts]
 */

import { assertRejects } from "@std/assert";
import { withEnv } from "@exaix/testing";
import { evaluateReference, ReferenceEvaluationError } from "../../runner/calibration_reference.ts";
import { NO_BACKWARD_KEYS } from "./helpers/calibration_reference_fixture.ts";

Deno.test({
  name:
    "[CalibrationReference][security] an unrecognized referenceProvider fails loud rather than silently resolving to a substitute",
  fn: async () => {
    // ModelResolver rejects an unknown preferred_provider before any network call.
    // That is stricter than the post-hoc resolved.provider check, with the same
    // guarantee: never a silent swap.
    await withEnv({ ...NO_BACKWARD_KEYS }, async () => {
      await assertRejects(
        () =>
          evaluateReference({
            requestContext: "Add input validation to the login form.",
            artifact: "## Plan\n1. Validate email format\n2. Validate password length",
            preset: "GOAL_ALIGNED_REVIEW",
            labelThreshold: 0.7,
            referenceProvider: "not-a-real-provider",
            referenceModel: "not-a-real-model",
          }),
        ReferenceEvaluationError,
      );
    });
  },
  sanitizeOps: false,
  sanitizeResources: false,
});
