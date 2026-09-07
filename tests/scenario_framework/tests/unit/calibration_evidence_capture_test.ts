/**
 * @module ScenarioFrameworkCalibrationEvidenceCaptureTest
 * @path tests/scenario_framework/tests/unit/calibration_evidence_capture_test.ts
 * @description Phase 146 Step 1 — the write side of real-artifact capture:
 *   captureCalibrationEvidence writes a content-addressed snapshot and appends a
 *   `.jsonl` index entry, is idempotent for identical content, and its compiled
 *   output round-trips cleanly through readCalibrationSources — proving the writer
 *   built in this slice actually produces what the reader built earlier expects.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/calibration_sources.ts]
 */

import { assertEquals, assertNotEquals } from "@std/assert";
import { join } from "@std/path";
import {
  CALIBRATION_SOURCE_INDEX_JSONL_NAME,
  captureCalibrationEvidence,
  compileCalibrationSourceIndex,
  readCalibrationSources,
} from "../../runner/calibration_sources.ts";

async function withTempDir(fn: (root: string) => Promise<void>): Promise<void> {
  const root = await Deno.makeTempDir();
  try {
    await fn(root);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
}

function captureInput(overrides: { runId?: string; stepId?: string; requestContext?: string } = {}) {
  return {
    runId: overrides.runId ?? "run-1",
    stepId: overrides.stepId ?? "step-1",
    requestContext: overrides.requestContext ?? "Please review this plan for goal alignment.",
    artifact: "## Plan\n1. Do X\n2. Do Y",
    rubricMethodology: "Score each criterion from 0 to 1.",
    executionStatus: "completed",
    sourceRevision: "abc123",
  };
}

Deno.test("[CalibrationEvidenceCapture] writes a content-addressed snapshot matching the returned hash", async () => {
  await withTempDir(async (root) => {
    const entry = await captureCalibrationEvidence({ captureDirectory: root, ...captureInput() });

    const snapshotBytes = await Deno.readTextFile(join(root, entry.snapshot_path));
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(snapshotBytes));
    const hex = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");

    assertEquals(hex, entry.snapshot_hash);
    assertEquals(entry.run_id, "run-1");
    assertEquals(entry.step_id, "step-1");

    const snapshot = JSON.parse(snapshotBytes);
    assertEquals(snapshot.real_run_marker, true);
    assertEquals(snapshot.request_context, "Please review this plan for goal alignment.");
  });
});

Deno.test("[CalibrationEvidenceCapture] appends one line per capture to the .jsonl index", async () => {
  await withTempDir(async (root) => {
    await captureCalibrationEvidence({ captureDirectory: root, ...captureInput({ runId: "run-1", stepId: "a" }) });
    await captureCalibrationEvidence({ captureDirectory: root, ...captureInput({ runId: "run-2", stepId: "b" }) });

    const indexText = await Deno.readTextFile(join(root, CALIBRATION_SOURCE_INDEX_JSONL_NAME));
    const lines = indexText.split("\n").filter((line) => line.trim().length > 0);
    assertEquals(lines.length, 2);

    const entries = await compileCalibrationSourceIndex(join(root, CALIBRATION_SOURCE_INDEX_JSONL_NAME));
    assertEquals(entries.map((entry) => entry.run_id), ["run-1", "run-2"]);
  });
});

Deno.test("[CalibrationEvidenceCapture] identical content is idempotent — same snapshot_hash, snapshot written once", async () => {
  await withTempDir(async (root) => {
    const first = await captureCalibrationEvidence({ captureDirectory: root, ...captureInput({ stepId: "first" }) });
    const second = await captureCalibrationEvidence({
      captureDirectory: root,
      ...captureInput({ stepId: "second" }),
    });

    assertEquals(first.snapshot_hash, second.snapshot_hash);
    assertEquals(first.snapshot_path, second.snapshot_path);

    // Both captures are still recorded in the index — dedup is the reader's job, not the writer's.
    const entries = await compileCalibrationSourceIndex(join(root, CALIBRATION_SOURCE_INDEX_JSONL_NAME));
    assertEquals(entries.length, 2);
    assertEquals(entries[0].snapshot_hash, entries[1].snapshot_hash);
  });
});

Deno.test("[CalibrationEvidenceCapture] different content produces different snapshot files", async () => {
  await withTempDir(async (root) => {
    const first = await captureCalibrationEvidence({
      captureDirectory: root,
      ...captureInput({ requestContext: "context A" }),
    });
    const second = await captureCalibrationEvidence({
      captureDirectory: root,
      ...captureInput({ requestContext: "context B" }),
    });

    assertNotEquals(first.snapshot_hash, second.snapshot_hash);
    assertNotEquals(first.snapshot_path, second.snapshot_path);
  });
});

Deno.test("[CalibrationEvidenceCapture] end-to-end: capture 50 real snapshots, compile, and read them back", async () => {
  await withTempDir(async (root) => {
    for (let i = 0; i < 50; i++) {
      await captureCalibrationEvidence({
        captureDirectory: root,
        ...captureInput({ runId: `run-${i}`, stepId: `step-${i}`, requestContext: `context for item ${i}` }),
      });
    }

    const entries = await compileCalibrationSourceIndex(join(root, CALIBRATION_SOURCE_INDEX_JSONL_NAME));
    assertEquals(entries.length, 50);

    const sourceIndexPath = join(root, "compiled-source-index.json");
    await Deno.writeTextFile(sourceIndexPath, JSON.stringify(entries));

    const selection = await readCalibrationSources({
      sourceIndexPath,
      snapshotRoot: root,
      seed: "seed-1",
      sampleCount: 50,
    });

    assertEquals(selection.selected.length, 50);
    assertEquals(selection.excluded.length, 0);
  });
});
