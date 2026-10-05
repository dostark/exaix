/**
 * @module CalibrationFrozenSet
 * @path packages/eval-history/src/calibration/frozen.ts
 * @description Pure validation and canonical hashing for a version-2 frozen calibration
 *   set. It proves every item shares the manifest's artifact assembly, redaction and
 *   frozen reference judge, that the single active reference track is OpenAI, that every
 *   stored label matches its score, and that the item and dataset content hashes match.
 *   Pure — no provider, filesystem or config dependency.
 * @architectural-layer Shared
 * @dependencies [@exaix/core/types, ./identity.ts, ./schema.ts, ./metrics.ts]
 * @related-files [packages/eval-history/src/calibration/schema.ts, packages/eval-history/src/calibration/identity.ts]
 */

import type { JSONValue } from "@exaix/core/types";
import { hashCalibrationValue } from "./identity.ts";
import { deriveCalibrationLabel } from "./metrics.ts";
import {
  CalibrationItemV2Schema,
  CalibrationManifestV2Schema,
  CalibrationVendor,
  type ICalibrationItemV2,
  type ICalibrationManifestV2,
} from "./schema.ts";

export interface IFrozenCalibrationSet {
  readonly manifest: ICalibrationManifestV2;
  readonly items: readonly ICalibrationItemV2[];
}

/** A frozen-set integrity failure carries a stable, non-secret code. */
export class CalibrationFrozenSetError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "CalibrationFrozenSetError";
  }
}

function toCanonicalValue<T>(value: T): JSONValue {
  return JSON.parse(JSON.stringify(value));
}

/** Canonical content hash of one frozen item, the value a manifest records. */
export async function hashFrozenCalibrationItem(item: ICalibrationItemV2): Promise<string> {
  return await hashCalibrationValue(toCanonicalValue(item));
}

/** Canonical content hash of the whole frozen set, excluding its own stored digest. */
export async function hashFrozenCalibrationDataset(set: IFrozenCalibrationSet): Promise<string> {
  return await hashCalibrationValue({
    artifact_ids: [...set.manifest.artifact_ids],
    dataset_version: set.manifest.dataset_version,
    item_hashes: [...set.manifest.items.item_hashes],
    rubric_hash: set.manifest.rubric_hash,
    selection_seed: set.manifest.selection_seed,
    source_index_hash: set.manifest.source_index_hash,
  });
}

/** Validates a frozen set and returns its strict parsed form. */
export async function validateFrozenCalibrationSet(set: IFrozenCalibrationSet): Promise<IFrozenCalibrationSet> {
  const manifest = CalibrationManifestV2Schema.parse(set.manifest);
  const items = set.items.map((item) => CalibrationItemV2Schema.parse(item));

  if (items.length !== manifest.artifact_ids.length) {
    throw new CalibrationFrozenSetError("calibration-frozen-item-count-mismatch");
  }
  const expectedIds = [...manifest.artifact_ids].sort();
  const itemIds = items.map((item) => item.semantic_id);
  if (JSON.stringify(itemIds) !== JSON.stringify(expectedIds)) {
    throw new CalibrationFrozenSetError("calibration-frozen-item-id-mismatch");
  }

  for (const item of items) {
    const assembly = item.artifact_context_assembly;
    const sharedAssembly = manifest.artifact_context_assembly;
    if (
      assembly.policy_hash !== sharedAssembly.policy_hash || assembly.version !== sharedAssembly.version ||
      item.redaction_hash !== manifest.redaction_hash || item.redaction_version !== manifest.redaction_version ||
      item.frozen_rubric.judge_assembly.policy_hash !== manifest.frozen_reference_judge_assembly.policy_hash
    ) {
      throw new CalibrationFrozenSetError("calibration-frozen-assembly-mismatch");
    }
    const rubricHash = await hashCalibrationValue(toCanonicalValue(item.frozen_rubric));
    if (rubricHash !== manifest.rubric_hash) {
      throw new CalibrationFrozenSetError("calibration-frozen-rubric-mismatch");
    }
    if (item.reference_label !== deriveCalibrationLabel(item.reference_score, item.frozen_rubric.label_threshold)) {
      throw new CalibrationFrozenSetError("calibration-frozen-label-mismatch");
    }
    if (item.reference_provenance.vendor !== CalibrationVendor.Openai) {
      throw new CalibrationFrozenSetError("calibration-frozen-reference-vendor-mismatch");
    }
  }

  const recomputedHashes = await Promise.all(items.map((item) => hashFrozenCalibrationItem(item)));
  if (JSON.stringify(recomputedHashes) !== JSON.stringify(manifest.items.item_hashes)) {
    throw new CalibrationFrozenSetError("calibration-frozen-item-hash-mismatch");
  }
  const datasetHash = await hashFrozenCalibrationDataset({ manifest, items });
  if (datasetHash !== manifest.dataset_content_hash) {
    throw new CalibrationFrozenSetError("calibration-frozen-dataset-hash-mismatch");
  }
  return { manifest, items };
}
