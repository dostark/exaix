/**
 * @module CalibrationReferenceFixture
 * @path tests/scenario_framework/tests/unit/helpers/calibration_reference_fixture.ts
 * @description Shared environment guard for the calibration reference tests: clears the
 *   provider API keys so an ambient value cannot route the evaluator off the mock.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/tests/unit/calibration_reference_test.ts, tests/scenario_framework/tests/unit/calibration_reference_security_test.ts]
 */

export const NO_BACKWARD_KEYS: Record<string, null> = {
  ANTHROPIC_API_KEY: null,
  OPENAI_API_KEY: null,
  GOOGLE_API_KEY: null,
  OPENROUTER_API_KEY: null,
};
