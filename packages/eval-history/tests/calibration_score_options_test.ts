/**
 * @module CalibrationScoreOptionsTest
 * @path packages/eval-history/tests/calibration_score_options_test.ts
 * @description Phase 146 Step 1 — strict validation for the `eval calibration score`
 *   options shared by apps/exactl's CLI dispatch and scripts/run_judge_calibration.ts,
 *   so both reject the same malformed input the same way.
 * @architectural-layer Test
 * @related-files [packages/eval-history/src/calibration/schema.ts]
 */

import { assertEquals } from "@std/assert";
import { CalibrationScoreOptionsSchema } from "../src/calibration/schema.ts";

const VALID_OPTIONS = {
  capture_dir: "/tmp/calibration-capture",
  seed: "phase-146-founding",
  sample_count: 50,
  target: "claude-cli:claude-sonnet-5",
  reference: "codex-cli:gpt-5.6-sol",
  isolated: true,
  label_threshold: 0.7,
};

Deno.test("[CalibrationScoreOptionsSchema] accepts a well-formed option set", () => {
  const result = CalibrationScoreOptionsSchema.safeParse(VALID_OPTIONS);
  assertEquals(result.success, true);
});

Deno.test("[CalibrationScoreOptionsSchema] rejects target/reference without a provider:model colon", () => {
  const result = CalibrationScoreOptionsSchema.safeParse({ ...VALID_OPTIONS, target: "claude-sonnet-5" });
  assertEquals(result.success, false);
});

Deno.test("[CalibrationScoreOptionsSchema] rejects an empty capture_dir", () => {
  const result = CalibrationScoreOptionsSchema.safeParse({ ...VALID_OPTIONS, capture_dir: "" });
  assertEquals(result.success, false);
});

Deno.test("[CalibrationScoreOptionsSchema] rejects a non-positive sample_count", () => {
  const result = CalibrationScoreOptionsSchema.safeParse({ ...VALID_OPTIONS, sample_count: 0 });
  assertEquals(result.success, false);
});

Deno.test("[CalibrationScoreOptionsSchema] rejects a label_threshold outside [0,1]", () => {
  const result = CalibrationScoreOptionsSchema.safeParse({ ...VALID_OPTIONS, label_threshold: 1.5 });
  assertEquals(result.success, false);
});

Deno.test("[CalibrationScoreOptionsSchema] rejects an unknown extra field", () => {
  const result = CalibrationScoreOptionsSchema.safeParse({ ...VALID_OPTIONS, extra: "nope" });
  assertEquals(result.success, false);
});
