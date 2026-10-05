/**
 * @module CalibrationSchema
 * @path packages/eval-history/src/calibration/schema.ts
 * @description Strict Zod schemas + inferred types for Phase 146 judge calibration
 *   records: Rubric, EvaluatorProvenance, Item, Manifest, Report, Baseline, and
 *   DriftEntry. Pure — no provider or filesystem dependencies. schema_version is
 *   pinned to the literal 1; an unknown/future version fails parsing (exit-2
 *   handling belongs to the CLI layer, not this module).
 * @architectural-layer Shared
 * @dependencies [zod, @exaix/core/config, @exaix/core/types]
 * @related-files [packages/eval-history/src/calibration/metrics.ts, packages/eval-history/src/calibration/identity.ts, packages/eval-history/src/calibration/constants.ts]
 */

import { z } from "zod";
import { resolveConfigurableBounds } from "@exaix/core/config";
import type { JSONValue } from "@exaix/core/types";
import { SHA256_HEX_PATTERN } from "./identity.ts";
import { CalibrationLabel, deriveCalibrationLabel, MetricUndefinedReason } from "./metrics.ts";
import { CALIBRATION_SAMPLE_COUNT_MAX, DEFAULT_CALIBRATION_SAMPLE_COUNT } from "./constants.ts";

const ARTIFACT_IDS_FIELD: string = "artifact_ids";

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
  const { min: sampleMin, max: sampleMax } = resolveConfigurableBounds("eval.calibration.sample_count");
  const minArtifacts = sampleMin ?? DEFAULT_CALIBRATION_SAMPLE_COUNT;
  const maxArtifacts: number = sampleMax ?? CALIBRATION_SAMPLE_COUNT_MAX;

  const uniqueIds = new Set(manifest.artifact_ids);
  if (uniqueIds.size !== manifest.artifact_ids.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: [ARTIFACT_IDS_FIELD], message: "artifact_ids must be unique" });
  }
  const sortedIds = [...manifest.artifact_ids].sort();
  if (manifest.artifact_ids.some((id, index) => id !== sortedIds[index])) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: [ARTIFACT_IDS_FIELD],
      message: "artifact_ids must be sorted ascending",
    });
  }
  if (manifest.artifact_ids.length < minArtifacts) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: [ARTIFACT_IDS_FIELD],
      message: `artifact_ids must contain at least ${minArtifacts} unique artifacts`,
    });
  }
  if (manifest.artifact_ids.length > maxArtifacts) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: [ARTIFACT_IDS_FIELD],
      message: `artifact_ids must contain at most ${maxArtifacts} unique artifacts`,
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

// Version-2 frozen lifecycle records. Version 1 remains inspectable only, never upgraded.

const CALIBRATION_SCHEMA_VERSION_V2 = 2;

/** Stored version-1 records stay readable but cannot establish a new v2 baseline. */
export const LEGACY_CALIBRATION_SCHEMA_VERSION = 1;

export class CalibrationLegacyRecordError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CalibrationLegacyRecordError";
  }
}

/** Surfaces that own a versioned, hashed assembly-policy identity. */
export enum CalibrationAssemblySurface {
  ArtifactGeneration = "artifact-generation",
  JudgePrompt = "judge-prompt",
}

/** An assembly-policy identity is a surface, a version and a policy digest. */
export const CalibrationAssemblyIdentitySchema = z.object({
  surface: z.nativeEnum(CalibrationAssemblySurface),
  version: z.string().min(1),
  policy_hash: Sha256HexSchema,
}).strict();

export type ICalibrationAssemblyIdentity = z.infer<typeof CalibrationAssemblyIdentitySchema>;

/** A frozen criterion definition, including the fields its prompt used. */
export const CalibrationCriterionDefinitionSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  weight: z.number().min(0),
  required: z.boolean(),
  category: z.enum(["completeness", "correctness"]),
  anchors: z.record(z.string(), z.string().min(1)).optional(),
}).strict();

export type ICalibrationCriterionDefinition = z.infer<typeof CalibrationCriterionDefinitionSchema>;

/** Version-2 rubric freezes criteria, methodology, template and metric policy. */
export const CalibrationRubricV2Schema = z.object({
  schema_version: z.literal(CALIBRATION_SCHEMA_VERSION_V2),
  id: z.literal(RUBRIC_PLAN_QUALITY_ID),
  version: z.string().min(1),
  preset: z.literal(RUBRIC_GOAL_ALIGNED_REVIEW_PRESET),
  criteria: z.array(CalibrationCriterionDefinitionSchema).min(1),
  label_threshold: z.number().min(0).max(1),
  methodology_text: z.string().min(1),
  methodology_hash: Sha256HexSchema,
  template_text: z.string().min(1),
  template_hash: Sha256HexSchema,
  metric_policy: z.string().min(1),
  judge_assembly: CalibrationAssemblyIdentitySchema,
}).strict();

export type ICalibrationRubricV2 = z.infer<typeof CalibrationRubricV2Schema>;

/** Version-2 evidence snapshot keeps the true generation lineage and post-redaction bytes. */
export const CalibrationEvidenceSnapshotV2Schema = z.object({
  source_run_id: z.string().min(1),
  source_step_id: z.string().min(1),
  source_trace_id: z.string().uuid(),
  execution_outcome: z.enum(["pass", "fail"]),
  source_revision: z.string().min(1),
  request_context: z.string().min(1),
  artifact: z.string().min(1),
  methodology: z.string().min(1),
  redaction_version: z.string().min(1),
  redaction_hash: Sha256HexSchema,
  artifact_context_assembly: CalibrationAssemblyIdentitySchema,
  capture_judge_context_assembly: CalibrationAssemblyIdentitySchema,
  source_submission_hashes: z.record(z.string(), Sha256HexSchema),
}).strict();

export type ICalibrationEvidenceSnapshotV2 = z.infer<typeof CalibrationEvidenceSnapshotV2Schema>;

/** Version-2 provenance names the canonical vendor, the CLI transport and the judge assembly. */
export const CalibrationProvenanceV2Schema = z.object({
  vendor: z.nativeEnum(CalibrationVendor),
  transport: z.nativeEnum(CalibrationTransport),
  requested_model: z.string().min(1),
  resolved_model: z.string().min(1),
  observed_model: z.string().min(1).nullable(),
  identity_basis: z.nativeEnum(CalibrationIdentityBasis),
  cli_version: z.string().min(1),
  settings: z.record(z.string(), CalibrationScalarSettingSchema),
  configuration_hash: Sha256HexSchema,
  judge_context_assembly: CalibrationAssemblyIdentitySchema,
}).strict();

export type ICalibrationProvenanceV2 = z.infer<typeof CalibrationProvenanceV2Schema>;

export const CalibrationSourceLineageV2Schema = z.object({
  run_id: z.string().min(1),
  step_id: z.string().min(1),
  trace_id: z.string().uuid(),
}).strict();

export type ICalibrationSourceLineageV2 = z.infer<typeof CalibrationSourceLineageV2Schema>;

/** Version-2 publication item binds one semantic artifact to one frozen reference label. */
export const CalibrationItemV2Schema = z.object({
  schema_version: z.literal(CALIBRATION_SCHEMA_VERSION_V2),
  semantic_id: Sha256HexSchema,
  snapshot_integrity_hash: Sha256HexSchema,
  request_context: z.string().min(1),
  artifact: z.string().min(1),
  frozen_rubric: CalibrationRubricV2Schema,
  artifact_context_assembly: CalibrationAssemblyIdentitySchema,
  redaction_version: z.string().min(1),
  redaction_hash: Sha256HexSchema,
  source_lineage: CalibrationSourceLineageV2Schema,
  reference_score: z.number().min(0).max(1),
  reference_label: z.nativeEnum(CalibrationLabel),
  reference_rationale: z.string().min(1),
  reference_provenance: CalibrationProvenanceV2Schema,
  full_prompt_hash: Sha256HexSchema,
}).strict();

export type ICalibrationItemV2 = z.infer<typeof CalibrationItemV2Schema>;

const CalibrationActiveTrackV2Schema = z.object({
  target_vendor: z.literal(CalibrationVendor.Anthropic),
  reference_vendor: z.literal(CalibrationVendor.Openai),
}).strict();

const CalibrationItemCoverageV2Schema = z.object({
  item_hashes: z.array(Sha256HexSchema).min(1),
  count: z.number().int().min(1),
  label_distribution: CalibrationLabelDistributionSchema,
}).strict();

/** Version-2 manifest pins one active target/reference track and every assembly identity. */
export const CalibrationManifestV2Schema = z.object({
  schema_version: z.literal(CALIBRATION_SCHEMA_VERSION_V2),
  dataset_version: z.string().min(1),
  rubric_hash: Sha256HexSchema,
  selection_seed: z.string().min(1),
  source_index_hash: Sha256HexSchema,
  artifact_ids: z.array(Sha256HexSchema).min(1),
  artifact_context_assembly: CalibrationAssemblyIdentitySchema,
  redaction_version: z.string().min(1),
  redaction_hash: Sha256HexSchema,
  frozen_reference_judge_assembly: CalibrationAssemblyIdentitySchema,
  active_tracks: z.array(CalibrationActiveTrackV2Schema).length(1),
  items: CalibrationItemCoverageV2Schema,
  dataset_content_hash: Sha256HexSchema,
  generated_at: UtcDatetimeSchema,
}).strict().superRefine((manifest, ctx) => {
  const { min: sampleMin, max: sampleMax } = resolveConfigurableBounds("eval.calibration.sample_count");
  const minArtifacts = sampleMin ?? DEFAULT_CALIBRATION_SAMPLE_COUNT;
  const maxArtifacts: number = sampleMax ?? CALIBRATION_SAMPLE_COUNT_MAX;

  const uniqueIds = new Set(manifest.artifact_ids);
  if (uniqueIds.size !== manifest.artifact_ids.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: [ARTIFACT_IDS_FIELD], message: "artifact_ids must be unique" });
  }
  const sortedIds = [...manifest.artifact_ids].sort();
  if (manifest.artifact_ids.some((id, index) => id !== sortedIds[index])) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: [ARTIFACT_IDS_FIELD],
      message: "artifact_ids must be sorted ascending",
    });
  }
  if (manifest.artifact_ids.length < minArtifacts) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: [ARTIFACT_IDS_FIELD],
      message: `artifact_ids must contain at least ${minArtifacts} unique artifacts`,
    });
  }
  if (manifest.artifact_ids.length > maxArtifacts) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: [ARTIFACT_IDS_FIELD],
      message: `artifact_ids must contain at most ${maxArtifacts} unique artifacts`,
    });
  }
  if (manifest.items.count !== manifest.artifact_ids.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["items", "count"],
      message: "item coverage count must equal the artifact_ids length",
    });
  }
  if (manifest.items.item_hashes.length !== manifest.artifact_ids.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["items", "item_hashes"],
      message: "item coverage hashes must cover the identical artifact_ids set",
    });
  }
}).describe("Version-2 publication pins one active track and a complete item coverage set");

export type ICalibrationManifestV2 = z.infer<typeof CalibrationManifestV2Schema>;

function asCalibrationRecord(value: JSONValue): Record<string, JSONValue> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, JSONValue>
    : undefined;
}

/** True when a stored record is an inspect-only version-1 record. A version-1 item
 *  carries no version field, so its shape is the legacy tell. */
export function isLegacyCalibrationRecord(value: JSONValue): boolean {
  const record = asCalibrationRecord(value);
  if (!record) return false;
  if (record.schema_version === LEGACY_CALIBRATION_SCHEMA_VERSION) return true;
  return record.schema_version === undefined && typeof record.source_snapshot_hash === "string" &&
    !Object.hasOwn(record, "semantic_id");
}

/** Reads a version-1 item for inspection only. It cannot be upgraded or republished. */
export function readLegacyCalibrationItem(raw: JSONValue): ICalibrationItem {
  if (!isLegacyCalibrationRecord(raw)) {
    throw new CalibrationLegacyRecordError("calibration-legacy-not-a-v1-record");
  }
  return CalibrationItemSchema.parse(raw);
}

/** Reads a version-2 frozen item. A legacy or unknown version is ineligible. */
export function readFrozenCalibrationItem(raw: JSONValue): ICalibrationItemV2 {
  const record = asCalibrationRecord(raw);
  if (!record) {
    throw new CalibrationLegacyRecordError("calibration-frozen-not-an-object");
  }
  const version = record.schema_version;
  if (version === LEGACY_CALIBRATION_SCHEMA_VERSION || (version === undefined && isLegacyCalibrationRecord(raw))) {
    throw new CalibrationLegacyRecordError("calibration-frozen-legacy-ineligible");
  }
  if (version !== CALIBRATION_SCHEMA_VERSION_V2) {
    throw new CalibrationLegacyRecordError("calibration-frozen-unknown-version");
  }
  return CalibrationItemV2Schema.parse(raw);
}
