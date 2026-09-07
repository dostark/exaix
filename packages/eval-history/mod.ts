/**
 * @module EvalHistory
 * @path packages/eval-history/mod.ts
 * @architectural-layer Services
 * @description Evaluation-history store + schema (Phase 100 Evaluation Framework).
 *   Relocated out of tests/scenario_framework so the `exactl eval` command can consume
 *   it without a production-to-tests dependency (the deploy-blocking layering violation).
 * @related-files [packages/eval-history/src/history_sqlite.ts, packages/eval-history/src/history_schema.ts]
 */

export { EvalSqliteStore, resolveEvalDbPath } from "./src/history_sqlite.ts";
export type { IFamilySummaryRow, IOutcomeRunRow } from "./src/history_sqlite.ts";
export { EvalHistoryEntrySchema, getDefaultComponentVersions, StepResultSchema } from "./src/history_schema.ts";
export type { IComponentVersions, IEvalHistoryEntry, IStepResult } from "./src/history_schema.ts";
export { EXTERNAL_BENCHMARK_CAVEAT } from "./src/external_benchmark.ts";

export { alignCalibrationPairs, CalibrationLabel, deriveCalibrationLabel } from "./src/calibration/metrics.ts";
export { CalibrationMetricError, CalibrationMetricErrorCode } from "./src/calibration/metrics.ts";
export { computeCohenKappa, computeExactAgreement, computeIntervalAlpha } from "./src/calibration/metrics.ts";
export { MetricUndefinedReason } from "./src/calibration/metrics.ts";
export type { ICalibrationAlignedPair, ICalibrationScoredItem } from "./src/calibration/metrics.ts";
export type { IMetricResult } from "./src/calibration/metrics.ts";
export { canonicalJsonStringify, hashCalibrationValue, sha256Hex } from "./src/calibration/identity.ts";
export { CalibrationCanonicalizationError, SHA256_HEX_PATTERN } from "./src/calibration/identity.ts";
export { DEFAULT_CALIBRATION_MAX_ITEM_BYTES, DEFAULT_CALIBRATION_SAMPLE_COUNT } from "./src/calibration/constants.ts";
export { CalibrationBaselineSchema, CalibrationDriftEntrySchema } from "./src/calibration/schema.ts";
export { CalibrationDriftOutcome, CalibrationIdentityBasis } from "./src/calibration/schema.ts";
export { CalibrationItemSchema, CalibrationManifestSchema, CalibrationReportSchema } from "./src/calibration/schema.ts";
export { CalibrationRubricSchema, CalibrationTransport, CalibrationVendor } from "./src/calibration/schema.ts";
export { EvaluatorProvenanceSchema, isCalibrationItemLabelConsistent } from "./src/calibration/schema.ts";
export type { ICalibrationBaseline, ICalibrationDriftEntry, ICalibrationItem } from "./src/calibration/schema.ts";
export type { ICalibrationManifest, ICalibrationReport, ICalibrationRubric } from "./src/calibration/schema.ts";
export type { IEvaluatorProvenance } from "./src/calibration/schema.ts";
