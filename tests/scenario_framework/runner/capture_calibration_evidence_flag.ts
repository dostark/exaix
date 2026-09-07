/**
 * @module CaptureCalibrationEvidenceFlag
 * @path tests/scenario_framework/runner/capture_calibration_evidence_flag.ts
 * @description Resolves the runner's `--capture-calibration-evidence <dir>` CLI flag into
 *   EXA_CAPTURE_CALIBRATION_EVIDENCE_DIR in the runner's own process env, mirroring
 *   capture_fixtures_flag.ts's established pattern: evaluateLlmJudgeCriterion runs
 *   in-process with the runner (no daemon subprocess boundary to cross here), so the env
 *   var is read directly rather than threaded through several layers of step-execution
 *   options structs. Default absent — ordinary scenario runs are unaffected.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/main.ts, tests/scenario_framework/runner/assertions.ts, tests/scenario_framework/runner/capture_fixtures_flag.ts]
 */

import { resolve } from "@std/path";
import type { Opt, Reason } from "@exaix/core/types";

/** Read by assertions.ts's evaluateLlmJudgeCriterion to build a default calibrationCapture. */
export const CAPTURE_CALIBRATION_EVIDENCE_ENV_VAR = "EXA_CAPTURE_CALIBRATION_EVIDENCE_DIR";

/** Applies `--capture-calibration-evidence <dir>`: resolves it to an absolute path and
 *  exports it into the runner's own process env. A no-op when no dir was given. */
export function applyCaptureCalibrationEvidenceFlag(dir: Opt<string, Reason.OptionalInput>): void {
  if (!dir) return;
  Deno.env.set(CAPTURE_CALIBRATION_EVIDENCE_ENV_VAR, resolve(dir));
}
