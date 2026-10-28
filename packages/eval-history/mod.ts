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
export type { IEvalOutcome, IEvalOutcomeReader, IFamilySummaryRow, IOutcomeRunRow } from "./src/history_sqlite.ts";
export { EvalHistoryEntrySchema, getDefaultComponentVersions, StepResultSchema } from "./src/history_schema.ts";
export type { IComponentVersions, IEvalHistoryEntry, IStepResult } from "./src/history_schema.ts";
export { EXTERNAL_BENCHMARK_CAVEAT } from "./src/external_benchmark.ts";

export { alignCalibrationPairs, CalibrationLabel, deriveCalibrationLabel } from "./src/calibration/metrics.ts";
export { CalibrationMetricError, CalibrationMetricErrorCode } from "./src/calibration/metrics.ts";
export { computeCohenKappa, computeExactAgreement, computeIntervalAlpha } from "./src/calibration/metrics.ts";
export { MetricUndefinedReason } from "./src/calibration/metrics.ts";
export type { ICalibrationScoredItem } from "./src/calibration/metrics.ts";
export type { IMetricResult } from "./src/calibration/metrics.ts";
export { canonicalJsonStringify, hashCalibrationValue, sha256Hex } from "./src/calibration/identity.ts";
export { CalibrationCanonicalizationError, SHA256_HEX_PATTERN } from "./src/calibration/identity.ts";
export { buildContextAssemblyIdentity, ContextAssemblyKind } from "./src/calibration/identity.ts";
export type { IContextAssemblyInput } from "./src/calibration/identity.ts";
export { ARTIFACT_CONTEXT_ASSEMBLY_VERSION, JUDGE_CONTEXT_ASSEMBLY_VERSION } from "./src/calibration/constants.ts";
export { DEFAULT_CALIBRATION_MAX_ITEM_BYTES, DEFAULT_CALIBRATION_SAMPLE_COUNT } from "./src/calibration/constants.ts";
export { CalibrationDriftEntrySchema } from "./src/calibration/schema.ts";
export { CalibrationDriftOutcome, CalibrationIdentityBasis } from "./src/calibration/schema.ts";
export { CalibrationItemSchema, CalibrationManifestSchema } from "./src/calibration/schema.ts";
export { CalibrationRubricSchema, CalibrationTransport, CalibrationVendor } from "./src/calibration/schema.ts";
export { isCalibrationItemLabelConsistent } from "./src/calibration/schema.ts";
export { CalibrationScoreOptionsSchema } from "./src/calibration/schema.ts";
export type { ICalibrationItem } from "./src/calibration/schema.ts";
export type { ICalibrationRubric } from "./src/calibration/schema.ts";
export type { IEvaluatorProvenance } from "./src/calibration/schema.ts";
export { CalibrationAssemblyIdentitySchema, CalibrationAssemblySurface } from "./src/calibration/schema.ts";
export { CalibrationItemV2Schema, CalibrationManifestV2Schema } from "./src/calibration/schema.ts";
export { isLegacyCalibrationRecord, readLegacyCalibrationItem } from "./src/calibration/schema.ts";
export { readFrozenCalibrationItem } from "./src/calibration/schema.ts";
export { validateFrozenCalibrationSet } from "./src/calibration/frozen.ts";
export { hashFrozenCalibrationDataset, hashFrozenCalibrationItem } from "./src/calibration/frozen.ts";
export type { ICalibrationAssemblyIdentity } from "./src/calibration/schema.ts";
export type { ICalibrationItemV2 } from "./src/calibration/schema.ts";
export type { ICalibrationManifestV2, ICalibrationProvenanceV2 } from "./src/calibration/schema.ts";
export type { ICalibrationRubricV2 } from "./src/calibration/schema.ts";
