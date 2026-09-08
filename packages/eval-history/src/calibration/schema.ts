/**
 * @module CalibrationSchema
 * @path packages/eval-history/src/calibration/schema.ts
 * @description Strict Zod schemas + inferred types for Phase 146 judge calibration
 *   records: Rubric, EvaluatorProvenance, Item, Manifest, Report, Baseline, and
 *   DriftEntry. Pure — no provider or filesystem dependencies. schema_version is
 *   pinned to the literal 1; an unknown/future version fails parsing (exit-2
 *   handling belongs to the CLI layer, not this module).
 * @architectural-layer Shared
 * @dependencies [zod, @exaix/core/config]
 * @related-files [packages/eval-history/src/calibration/metrics.ts, packages/eval-history/src/calibration/identity.ts, packages/eval-history/src/calibration/constants.ts]
 */

import { z } from "zod";
import { resolveConfigurableBounds } from "@exaix/core/config";
import { SHA256_HEX_PATTERN } from "./identity.ts";
import { CalibrationLabel, deriveCalibrationLabel, MetricUndefinedReason } from "./metrics.ts";
import { DEFAULT_CALIBRATION_SAMPLE_COUNT } from "./constants.ts";

/** Underlying model vendor a judge/reference evaluator resolves to — checked on the
 *  vendor, never the transport name, so `claude-cli` and the Anthropic API are the
 *  same vendor for provider-independence purposes. */
export enum CalibrationVendor {
  Anthropic = "anthropic",
  Openai = "openai",
}

/** Concrete execution transport used to reach a vendor's model. */
export enum CalibrationTransport {
  Anthropic = "anthropic",
  Openai = "openai",
  ClaudeCli = "claude-cli",
  CodexCli = "codex-cli",
}

/** How a provenance record's model identity was established. */
export enum CalibrationIdentityBasis {
  ProviderResponse = "provider-response",
  PinnedRequest = "pinned-request",
}

/** Outcome of one drift comparison run. */
export enum CalibrationDriftOutcome {
  Pass = "pass",
  Regression = "regression",
  NoBaseline = "no-baseline",
  Error = "error",
}

const CALIBRATION_SCHEMA_VERSION = 1;
const RUBRIC_PLAN_QUALITY_ID = "plan-quality";
const RUBRIC_GOAL_ALIGNED_REVIEW_PRESET = "GOAL_ALIGNED_REVIEW";

const Sha256HexSchema = z.string().regex(SHA256_HEX_PATTERN, "must be a lowercase 64-hex-character SHA256 digest");
const UtcDatetimeSchema = z.string().datetime({ offset: false });
const CalibrationScalarSettingSchema = z.union([z.string(), z.number(), z.boolean()]);

export const EvaluatorProvenanceSchema = z.object({
  vendor: z.nativeEnum(CalibrationVendor),
  transport: z.nativeEnum(CalibrationTransport),
  requested_model: z.string().min(1),
  resolved_model: z.string().min(1),
  observed_model: z.string().min(1).nullable(),
  identity_basis: z.nativeEnum(CalibrationIdentityBasis),
  cli_version: z.string().min(1).nullable(),
  settings: z.record(z.string(), CalibrationScalarSettingSchema),
  configuration_hash: Sha256HexSchema,
}).strict();

export type IEvaluatorProvenance = z.infer<typeof EvaluatorProvenanceSchema>;

export const CalibrationRubricCriterionSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  weight: z.number().min(0),
}).strict();

export const CalibrationRubricSchema = z.object({
  schema_version: z.literal(CALIBRATION_SCHEMA_VERSION),
  id: z.literal(RUBRIC_PLAN_QUALITY_ID),
  version: z.string().min(1),
  preset: z.literal(RUBRIC_GOAL_ALIGNED_REVIEW_PRESET),
  criteria: z.array(CalibrationRubricCriterionSchema).min(1),
  label_threshold: z.number().min(0).max(1),
  methodology_text: z.string().min(1),
  methodology_hash: Sha256HexSchema,
}).strict();

export type ICalibrationRubric = z.infer<typeof CalibrationRubricSchema>;

export const CalibrationItemSchema = z.object({
  id: Sha256HexSchema,
  source_run_id: z.string().min(1),
  source_step_id: z.string().min(1),
  request_context: z.string().min(1),
  artifact: z.string().min(1),
  source_snapshot_hash: Sha256HexSchema,
  rubric_version: z.string().min(1),
  reference_label: z.nativeEnum(CalibrationLabel),
  reference_score: z.number().min(0).max(1),
  reference_rationale: z.string().min(1),
  reference_provenance: EvaluatorProvenanceSchema,
  full_prompt_hash: Sha256HexSchema,
}).strict();

export type ICalibrationItem = z.infer<typeof CalibrationItemSchema>;

/** True iff the item's stored `reference_label` matches the label canonically derived
 *  from its `reference_score` at `labelThreshold` — a conflicting stored label fails
 *  integrity regardless of how it was produced. */
export function isCalibrationItemLabelConsistent(item: ICalibrationItem, labelThreshold: number): boolean {
  return item.reference_label === deriveCalibrationLabel(item.reference_score, labelThreshold);
}

const CalibrationLabelDistributionSchema = z.object({
  pass: z.number().int().min(0),
  fail: z.number().int().min(0),
}).strict();

const CalibrationReferenceTrackSchema = z.object({
  item_hashes: z.array(Sha256HexSchema).min(1),
  count: z.number().int().min(1),
  label_distribution: CalibrationLabelDistributionSchema,
}).strict();

export const CalibrationManifestSchema = z.object({
  schema_version: z.literal(CALIBRATION_SCHEMA_VERSION),
  rubric: CalibrationRubricSchema,
  selection_seed: z.string().min(1),
  artifact_ids: z.array(z.string().min(1)),
  source_index_hash: Sha256HexSchema,
  reference_tracks: z.record(z.nativeEnum(CalibrationVendor), CalibrationReferenceTrackSchema),
  dataset_content_hash: Sha256HexSchema,
  generated_at: UtcDatetimeSchema,
}).strict().superRefine((manifest, ctx) => {
  const { min: sampleMin } = resolveConfigurableBounds("eval.calibration.sample_count");
  const minArtifacts = sampleMin ?? DEFAULT_CALIBRATION_SAMPLE_COUNT;

  const uniqueIds = new Set(manifest.artifact_ids);
  if (uniqueIds.size !== manifest.artifact_ids.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["artifact_ids"], message: "artifact_ids must be unique" });
  }
  const sortedIds = [...manifest.artifact_ids].sort();
  if (manifest.artifact_ids.some((id, index) => id !== sortedIds[index])) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["artifact_ids"],
      message: "artifact_ids must be sorted ascending",
    });
  }
  if (manifest.artifact_ids.length < minArtifacts) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["artifact_ids"],
      message: `artifact_ids must contain at least ${minArtifacts} unique artifacts`,
    });
  }

  for (const [vendor, track] of Object.entries(manifest.reference_tracks)) {
    if (track.count !== manifest.artifact_ids.length || track.item_hashes.length !== manifest.artifact_ids.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["reference_tracks", vendor],
        message: "reference track must cover the identical artifact_ids set as every other track",
      });
    }
  }
}).describe("Publication requires both target-vendor tracks to be present and cover the identical artifact set");

export type ICalibrationManifest = z.infer<typeof CalibrationManifestSchema>;

const MetricResultSchema = z.union([
  z.object({ value: z.number() }).strict(),
  z.object({ value: z.null(), reason: z.nativeEnum(MetricUndefinedReason) }).strict(),
]);

const CalibrationMetricsTripleSchema = z.object({
  exact: MetricResultSchema,
  kappa: MetricResultSchema,
  alpha: MetricResultSchema,
}).strict();

const CalibrationReportItemSchema = z.object({
  id: Sha256HexSchema,
  target_label: z.nativeEnum(CalibrationLabel),
  reference_label: z.nativeEnum(CalibrationLabel),
  target_score: z.number().min(0).max(1),
  reference_score: z.number().min(0).max(1),
  full_prompt_hash: Sha256HexSchema,
}).strict();

export const CalibrationReportSchema = z.object({
  schema_version: z.literal(CALIBRATION_SCHEMA_VERSION),
  run_id: z.string().uuid(),
  evaluated_git_sha: z.string().min(1),
  evaluated_tree_hash: Sha256HexSchema,
  generation_time: UtcDatetimeSchema,
  rubric_hash: Sha256HexSchema,
  dataset_hash: Sha256HexSchema,
  policy_hash: Sha256HexSchema,
  target_provenance: EvaluatorProvenanceSchema,
  reference_provenance: EvaluatorProvenanceSchema,
  items: z.array(CalibrationReportItemSchema).min(1),
  metrics: CalibrationMetricsTripleSchema,
  sample_count: z.number().int().min(1),
  real_execution_marker: z.literal(true),
  diagnostics: z.array(z.string()),
}).strict().superRefine((report, ctx) => {
  const sortedIds = [...report.items.map((item) => item.id)].sort();
  if (report.items.some((item, index) => item.id !== sortedIds[index])) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["items"], message: "items must be sorted ascending by id" });
  }
});

export type ICalibrationReport = z.infer<typeof CalibrationReportSchema>;

const CalibrationVendorTrackMetricsSchema = z.object({
  target_provenance: EvaluatorProvenanceSchema,
  reference_provenance: EvaluatorProvenanceSchema,
  metrics: CalibrationMetricsTripleSchema,
}).strict();

export const CalibrationBaselineSchema = z.object({
  schema_version: z.literal(CALIBRATION_SCHEMA_VERSION),
  baseline_id: z.string().min(1),
  rubric_hash: Sha256HexSchema,
  dataset_hash: Sha256HexSchema,
  policy_hash: Sha256HexSchema,
  target_tracks: z.record(z.nativeEnum(CalibrationVendor), CalibrationVendorTrackMetricsSchema),
  report_hashes: z.array(Sha256HexSchema).min(1),
  created_at: UtcDatetimeSchema,
}).strict();

export type ICalibrationBaseline = z.infer<typeof CalibrationBaselineSchema>;

const CalibrationDriftIdentitySchema = z.object({
  rubric_hash: Sha256HexSchema,
  dataset_hash: Sha256HexSchema,
  policy_hash: Sha256HexSchema,
  target_provenance: EvaluatorProvenanceSchema,
  reference_provenance: EvaluatorProvenanceSchema,
}).strict();

const CalibrationDeltaTripleSchema = z.object({
  exact: z.number().nullable(),
  kappa: z.number().nullable(),
  alpha: z.number().nullable(),
}).strict();

export const CalibrationDriftEntrySchema = z.object({
  schema_version: z.literal(CALIBRATION_SCHEMA_VERSION),
  run_id: z.string().uuid(),
  timestamp: UtcDatetimeSchema,
  identity: CalibrationDriftIdentitySchema,
  current_metrics: CalibrationMetricsTripleSchema.nullable(),
  previous_run_deltas: CalibrationDeltaTripleSchema.nullable(),
  baseline_deltas: CalibrationDeltaTripleSchema.nullable(),
  outcome: z.nativeEnum(CalibrationDriftOutcome),
  report_hash: Sha256HexSchema,
  reason_code: z.string().min(1).nullable(),
}).strict().superRefine((entry, ctx) => {
  const requiresReason = entry.outcome === CalibrationDriftOutcome.NoBaseline ||
    entry.outcome === CalibrationDriftOutcome.Error;
  if (requiresReason && entry.reason_code === null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["reason_code"],
      message: `reason_code is required when outcome is "${entry.outcome}"`,
    });
  }
  if (!requiresReason && entry.reason_code !== null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["reason_code"],
      message: `reason_code must be null when outcome is "${entry.outcome}"`,
    });
  }
});

export type ICalibrationDriftEntry = z.infer<typeof CalibrationDriftEntrySchema>;

const CalibrationVendorTargetStringSchema = z.string().regex(
  /^[^:]+:.+$/,
  'must be "provider:model" (e.g. "claude-cli:claude-sonnet-5")',
);

/** Shared by apps/exactl's `eval calibration score` dispatch and
 *  scripts/run_judge_calibration.ts's own arg parsing, so both reject malformed input
 *  identically rather than drifting into two independent validation paths. */
export const CalibrationScoreOptionsSchema = z.object({
  capture_dir: z.string().min(1),
  seed: z.string().min(1),
  sample_count: z.number().int().min(1),
  target: CalibrationVendorTargetStringSchema,
  reference: CalibrationVendorTargetStringSchema,
  isolated: z.boolean(),
  label_threshold: z.number().min(0).max(1),
}).strict();

export type ICalibrationScoreOptions = z.infer<typeof CalibrationScoreOptionsSchema>;
