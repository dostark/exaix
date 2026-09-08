/**
 * @module CalibrationSetIntegrityTest
 * @path packages/eval-history/tests/calibration_set_integrity_test.ts
 * @description Phase 146 Step 1 — strict schema validation, canonical hashing,
 *   conflicting-label detection, required-field enforcement, identical-track
 *   coverage, schema-version rejection, and the sample-count config bound for
 *   the judge-calibration record set.
 * @architectural-layer Test
 * @related-files [packages/eval-history/src/calibration/schema.ts, packages/eval-history/src/calibration/identity.ts]
 */

import { assertEquals, assertNotEquals } from "@std/assert";
import {
  CalibrationDriftEntrySchema,
  CalibrationDriftOutcome,
  CalibrationIdentityBasis,
  CalibrationItemSchema,
  CalibrationManifestSchema,
  CalibrationRubricSchema,
  CalibrationTransport,
  CalibrationVendor,
  type ICalibrationItem,
  type IEvaluatorProvenance,
  isCalibrationItemLabelConsistent,
} from "../src/calibration/schema.ts";
import { canonicalJsonStringify, hashCalibrationValue, sha256Hex } from "../src/calibration/identity.ts";
import { CalibrationLabel, MetricUndefinedReason } from "../src/calibration/metrics.ts";

const SHA256_OF_EMPTY = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

function provenance(overrides: Partial<IEvaluatorProvenance> = {}): IEvaluatorProvenance {
  return {
    vendor: CalibrationVendor.Openai,
    transport: CalibrationTransport.CodexCli,
    requested_model: "gpt-5.6-sol",
    resolved_model: "gpt-5.6-sol",
    observed_model: null,
    identity_basis: CalibrationIdentityBasis.PinnedRequest,
    cli_version: "1.0.0",
    settings: {},
    configuration_hash: SHA256_OF_EMPTY,
    ...overrides,
  };
}

function calibrationItem(overrides: Partial<ICalibrationItem> = {}): ICalibrationItem {
  return {
    id: SHA256_OF_EMPTY,
    source_run_id: "run-1",
    source_step_id: "step-1",
    request_context: "context",
    artifact: "artifact",
    source_snapshot_hash: SHA256_OF_EMPTY,
    rubric_version: "1.0.0",
    reference_label: CalibrationLabel.Pass,
    reference_score: 0.9,
    reference_rationale: "meets goal alignment",
    reference_provenance: provenance(),
    full_prompt_hash: SHA256_OF_EMPTY,
    ...overrides,
  };
}

function rubric() {
  return {
    schema_version: 1,
    id: "plan-quality",
    version: "1.0.0",
    preset: "GOAL_ALIGNED_REVIEW",
    criteria: [{ name: "goal_alignment", description: "aligns with the stated goal", weight: 2 }],
    label_threshold: 0.7,
    methodology_text: "score each criterion 0-1",
    methodology_hash: SHA256_OF_EMPTY,
  };
}

function manifestWithArtifactCount(count: number) {
  const artifactIds = Array.from({ length: count }, (_, index) => `artifact-${String(index).padStart(4, "0")}`);
  const track = {
    item_hashes: artifactIds.map(() => SHA256_OF_EMPTY),
    count: artifactIds.length,
    label_distribution: { pass: artifactIds.length, fail: 0 },
  };
  return {
    schema_version: 1,
    rubric: rubric(),
    selection_seed: "seed-1",
    artifact_ids: artifactIds,
    source_index_hash: SHA256_OF_EMPTY,
    reference_tracks: {
      [CalibrationVendor.Anthropic]: track,
      [CalibrationVendor.Openai]: track,
    },
    dataset_content_hash: SHA256_OF_EMPTY,
    generated_at: new Date().toISOString(),
  };
}

// Hashing

Deno.test("[CalibrationSetIntegrity] sha256Hex matches the well-known digest of the empty string", async () => {
  const digest = await sha256Hex("");
  assertEquals(digest, "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
});

Deno.test("[CalibrationSetIntegrity] canonicalJsonStringify sorts object keys recursively", () => {
  const canonical = canonicalJsonStringify({ b: 1, a: { d: 2, c: 3 } });
  assertEquals(canonical, '{"a":{"c":3,"d":2},"b":1}\n');
});

Deno.test("[CalibrationSetIntegrity] hashCalibrationValue is stable under key reordering", async () => {
  const left = await hashCalibrationValue({ a: 1, b: 2 });
  const right = await hashCalibrationValue({ b: 2, a: 1 });
  assertEquals(left, right);
});

Deno.test("[CalibrationSetIntegrity] hashCalibrationValue differs for different content", async () => {
  const left = await hashCalibrationValue({ a: 1 });
  const right = await hashCalibrationValue({ a: 2 });
  assertNotEquals(left, right);
});

// Strict schemas / required fields

Deno.test("[CalibrationSetIntegrity] CalibrationRubricSchema accepts a well-formed rubric", () => {
  const parsed = CalibrationRubricSchema.parse(rubric());
  assertEquals(parsed.id, "plan-quality");
});

Deno.test("[CalibrationSetIntegrity] CalibrationRubricSchema rejects a missing required field", () => {
  const { methodology_hash: _drop, ...incomplete } = rubric();
  const result = CalibrationRubricSchema.safeParse(incomplete);
  assertEquals(result.success, false);
});

Deno.test("[CalibrationSetIntegrity] CalibrationRubricSchema rejects unknown fields (strict)", () => {
  const result = CalibrationRubricSchema.safeParse({ ...rubric(), unexpected_field: true });
  assertEquals(result.success, false);
});

Deno.test("[CalibrationSetIntegrity] CalibrationItemSchema accepts a well-formed item", () => {
  const parsed = CalibrationItemSchema.parse(calibrationItem());
  assertEquals(parsed.reference_label, CalibrationLabel.Pass);
});

Deno.test("[CalibrationSetIntegrity] CalibrationItemSchema rejects an out-of-range reference_score", () => {
  const result = CalibrationItemSchema.safeParse(calibrationItem({ reference_score: 1.5 }));
  assertEquals(result.success, false);
});

// Conflicting labels

Deno.test("[CalibrationSetIntegrity] isCalibrationItemLabelConsistent — consistent pass label", () => {
  const item = calibrationItem({ reference_score: 0.9, reference_label: CalibrationLabel.Pass });
  assertEquals(isCalibrationItemLabelConsistent(item, 0.7), true);
});

Deno.test("[CalibrationSetIntegrity] isCalibrationItemLabelConsistent — consistent fail label", () => {
  const item = calibrationItem({ reference_score: 0.2, reference_label: CalibrationLabel.Fail });
  assertEquals(isCalibrationItemLabelConsistent(item, 0.7), true);
});

Deno.test("[CalibrationSetIntegrity] isCalibrationItemLabelConsistent — flags a conflicting stored label", () => {
  // score 0.9 >= threshold 0.7 canonically derives "pass", but the stored label says "fail".
  const item = calibrationItem({ reference_score: 0.9, reference_label: CalibrationLabel.Fail });
  assertEquals(isCalibrationItemLabelConsistent(item, 0.7), false);
});

// Manifest: identical tracks + sample-count config bound

Deno.test("[CalibrationSetIntegrity] CalibrationManifestSchema accepts complete identical ≥50-artifact tracks", () => {
  const result = CalibrationManifestSchema.safeParse(manifestWithArtifactCount(50));
  assertEquals(result.success, true);
});

Deno.test("[CalibrationSetIntegrity] CalibrationManifestSchema rejects fewer than the configured minimum (49 < 50)", () => {
  const result = CalibrationManifestSchema.safeParse(manifestWithArtifactCount(49));
  assertEquals(result.success, false);
});

Deno.test("[CalibrationSetIntegrity] CalibrationManifestSchema rejects duplicate artifact ids", () => {
  const manifest = manifestWithArtifactCount(50);
  manifest.artifact_ids[1] = manifest.artifact_ids[0];
  const result = CalibrationManifestSchema.safeParse(manifest);
  assertEquals(result.success, false);
});

Deno.test("[CalibrationSetIntegrity] CalibrationManifestSchema rejects an unsorted artifact_ids array", () => {
  const manifest = manifestWithArtifactCount(50);
  manifest.artifact_ids.reverse();
  const result = CalibrationManifestSchema.safeParse(manifest);
  assertEquals(result.success, false);
});

Deno.test("[CalibrationSetIntegrity] CalibrationManifestSchema rejects a track whose coverage does not match artifact_ids", () => {
  const manifest = manifestWithArtifactCount(50);
  manifest.reference_tracks[CalibrationVendor.Openai].item_hashes.pop();
  manifest.reference_tracks[CalibrationVendor.Openai].count -= 1;
  const result = CalibrationManifestSchema.safeParse(manifest);
  assertEquals(result.success, false);
});

// Schema-version rejection

Deno.test("[CalibrationSetIntegrity] CalibrationRubricSchema rejects a future/unknown schema_version", () => {
  const result = CalibrationRubricSchema.safeParse({ ...rubric(), schema_version: 2 });
  assertEquals(result.success, false);
});

Deno.test("[CalibrationSetIntegrity] CalibrationManifestSchema rejects a future/unknown schema_version", () => {
  const manifest = manifestWithArtifactCount(50);
  const result = CalibrationManifestSchema.safeParse({ ...manifest, schema_version: 0 });
  assertEquals(result.success, false);
});

// Drift entry: nullable metrics + explicit reason codes

function driftIdentity() {
  return {
    rubric_hash: SHA256_OF_EMPTY,
    dataset_hash: SHA256_OF_EMPTY,
    policy_hash: SHA256_OF_EMPTY,
    target_provenance: provenance({ vendor: CalibrationVendor.Anthropic, transport: CalibrationTransport.ClaudeCli }),
    reference_provenance: provenance(),
  };
}

Deno.test("[CalibrationSetIntegrity] CalibrationDriftEntrySchema accepts a no-baseline outcome with a reason code", () => {
  const result = CalibrationDriftEntrySchema.safeParse({
    schema_version: 1,
    run_id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    identity: driftIdentity(),
    current_metrics: null,
    previous_run_deltas: null,
    baseline_deltas: null,
    outcome: CalibrationDriftOutcome.NoBaseline,
    report_hash: SHA256_OF_EMPTY,
    reason_code: "no-enrolled-baseline",
  });
  assertEquals(result.success, true);
});

Deno.test("[CalibrationSetIntegrity] CalibrationDriftEntrySchema rejects a no-baseline outcome with a null reason code", () => {
  const result = CalibrationDriftEntrySchema.safeParse({
    schema_version: 1,
    run_id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    identity: driftIdentity(),
    current_metrics: null,
    previous_run_deltas: null,
    baseline_deltas: null,
    outcome: CalibrationDriftOutcome.NoBaseline,
    report_hash: SHA256_OF_EMPTY,
    reason_code: null,
  });
  assertEquals(result.success, false);
});

Deno.test("[CalibrationSetIntegrity] CalibrationDriftEntrySchema rejects a fabricated reason code on a pass outcome", () => {
  const result = CalibrationDriftEntrySchema.safeParse({
    schema_version: 1,
    run_id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    identity: driftIdentity(),
    current_metrics: {
      exact: { value: 0.9 },
      kappa: { value: 0.85 },
      alpha: { value: 0.82 },
    },
    previous_run_deltas: { exact: 0, kappa: 0, alpha: 0 },
    baseline_deltas: { exact: 0, kappa: 0, alpha: 0 },
    outcome: CalibrationDriftOutcome.Pass,
    report_hash: SHA256_OF_EMPTY,
    reason_code: "should-not-be-here",
  });
  assertEquals(result.success, false);
});

Deno.test("[CalibrationSetIntegrity] CalibrationDriftEntrySchema accepts an undefined-metric value (insufficient-data)", () => {
  const result = CalibrationDriftEntrySchema.safeParse({
    schema_version: 1,
    run_id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    identity: driftIdentity(),
    current_metrics: {
      exact: { value: 1 },
      kappa: { value: null, reason: MetricUndefinedReason.InsufficientData },
      alpha: { value: null, reason: MetricUndefinedReason.InsufficientData },
    },
    previous_run_deltas: null,
    baseline_deltas: null,
    outcome: CalibrationDriftOutcome.Pass,
    report_hash: SHA256_OF_EMPTY,
    reason_code: null,
  });
  assertEquals(result.success, true);
});
