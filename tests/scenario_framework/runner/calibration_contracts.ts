/**
 * @module CalibrationContracts
 * @path tests/scenario_framework/runner/calibration_contracts.ts
 * @description The vendor target, judge score and reference-adapter contracts shared by the calibration runner and its reference evaluator.
 * @architectural-layer TestSupport
 * @dependencies [@exaix/eval-history, tests/scenario_framework/runner/calibration_sources.ts]
 * @related-files [tests/scenario_framework/runner/calibration_runner.ts, tests/scenario_framework/runner/calibration_reference.ts]
 */

import type { ICalibrationRubric } from "@exaix/eval-history";
import type { ICalibrationSourceItem } from "./calibration_sources.ts";

export interface ICalibrationVendorTarget {
  readonly provider: string;
  readonly model: string;
}

export interface IJudgeScoreResult {
  readonly score: number;
  readonly provider: string;
  readonly model: string;
}

export interface ICalibrationReferenceAdapter {
  score(
    item: ICalibrationSourceItem,
    rubric: ICalibrationRubric,
    target: ICalibrationVendorTarget,
  ): Promise<IJudgeScoreResult>;
}
