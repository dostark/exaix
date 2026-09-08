/**
 * @module CalibrationConstants
 * @path packages/eval-history/src/calibration/constants.ts
 * @description Configurable policy defaults owned by Phase 146 judge calibration.
 *   Only keys actually consumed by an implemented slice are registered here;
 *   remaining gate/drift/isolation keys are added alongside the step that
 *   consumes them.
 * @architectural-layer Shared
 * @dependencies [@exaix/core/config]
 * @related-files [packages/eval-history/src/calibration/schema.ts, tests/scenario_framework/runner/calibration_sources.ts]
 */

import { configurable } from "@exaix/core/config";
import { ConfigValueType, SwapClass } from "@exaix/core";

const CALIBRATION_SAMPLE_COUNT_MIN = 50;
const CALIBRATION_SAMPLE_COUNT_MAX = 100;
const CALIBRATION_MAX_ITEM_BYTES_DEFAULT = 262144;
const CALIBRATION_MAX_ITEM_BYTES_MIN = 1024;
const CALIBRATION_MAX_ITEM_BYTES_MAX = 1048576;

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

/** Maximum byte size of one calibration evidence snapshot file, rejected before JSON parsing. */
export const DEFAULT_CALIBRATION_MAX_ITEM_BYTES: number = configurable({
  key: "eval.calibration.max_item_bytes",
  default: CALIBRATION_MAX_ITEM_BYTES_DEFAULT,
  type: ConfigValueType.NUMBER,
  description: "Maximum byte size of one judge-calibration evidence snapshot file",
  min: CALIBRATION_MAX_ITEM_BYTES_MIN,
  max: CALIBRATION_MAX_ITEM_BYTES_MAX,
  swap: SwapClass.HOT,
});
