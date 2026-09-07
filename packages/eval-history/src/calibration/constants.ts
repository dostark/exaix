/**
 * @module CalibrationConstants
 * @path packages/eval-history/src/calibration/constants.ts
 * @description Configurable policy defaults owned by Phase 146 judge calibration.
 *   Only keys actually consumed by the pure schema/identity/metrics slice are
 *   registered here; gate/drift/isolation keys (agreement_floor, timeout_ms, etc.)
 *   are added alongside the step that consumes them.
 * @architectural-layer Shared
 * @dependencies [@exaix/core/config]
 * @related-files [packages/eval-history/src/calibration/schema.ts]
 */

import { configurable } from "@exaix/core/config";
import { ConfigValueType, SwapClass } from "@exaix/core";

const CALIBRATION_SAMPLE_COUNT_MIN = 50;
const CALIBRATION_SAMPLE_COUNT_MAX = 100;

/** Default number of unique real artifacts sampled into a calibration reference track. */
export const DEFAULT_CALIBRATION_SAMPLE_COUNT: number = configurable({
  key: "eval.calibration.sample_count",
  default: CALIBRATION_SAMPLE_COUNT_MIN,
  type: ConfigValueType.NUMBER,
  description: "Number of unique real artifacts sampled into a judge-calibration reference track",
  min: CALIBRATION_SAMPLE_COUNT_MIN,
  max: CALIBRATION_SAMPLE_COUNT_MAX,
  swap: SwapClass.HOT,
});
