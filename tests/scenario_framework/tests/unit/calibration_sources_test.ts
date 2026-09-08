/**
 * @module ScenarioFrameworkCalibrationSourcesTest
 * @path tests/scenario_framework/tests/unit/calibration_sources_test.ts
 * @description Phase 146 Step 1 — real-artifact source reading: immutable snapshot
 *   validation, missing-context rejection, duplicate-id dedup, seeded deterministic
 *   selection, the fewer-than-minimum failure, and rejection of an escaping
 *   snapshot_path (the reader's analog of "never publish an unsafe item"). Plus the
 *   text-redaction helper's replace/reject split.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/calibration_sources.ts]
 */

import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import { dirname, join } from "@std/path";
import { sha256Hex } from "@exaix/eval-history";
import {
  CalibrationRedactionError,
  CalibrationSourceError,
  type ICalibrationEvidenceSnapshot,
  type ICalibrationSourceIndexEntry,
  readCalibrationSources,
  redactCalibrationSnapshot,
} from "../../runner/calibration_sources.ts";

function defaultSnapshot(overrides: Partial<ICalibrationEvidenceSnapshot> = {}): ICalibrationEvidenceSnapshot {
  return {
    request_context: "Please review this plan for goal alignment.",
    artifact: "## Plan\n1. Do X\n2. Do Y",
    rubric_methodology: "Score each criterion from 0 to 1.",
    real_run_marker: true,
    execution_status: "completed",
    source_revision: "abc123",
    ...overrides,
  };
}

async function writeSnapshotText(
  root: string,
  relativePath: string,
  text: string,
): Promise<ICalibrationSourceIndexEntry> {
  const fullPath = join(root, relativePath);
  await Deno.mkdir(dirname(fullPath), { recursive: true });
  await Deno.writeTextFile(fullPath, text);
  return {
    run_id: `run-${relativePath}`,
    step_id: `step-${relativePath}`,
    snapshot_path: relativePath,
    snapshot_hash: await sha256Hex(text),
  };
}

async function writeValidSnapshot(
  root: string,
  relativePath: string,
  overrides: Partial<ICalibrationEvidenceSnapshot> = {},
): Promise<ICalibrationSourceIndexEntry> {
  return await writeSnapshotText(root, relativePath, JSON.stringify(defaultSnapshot(overrides)));
}

async function writeSourceIndex(dir: string, entries: ICalibrationSourceIndexEntry[]): Promise<string> {
  const indexPath = join(dir, "source-index.json");
  await Deno.writeTextFile(indexPath, JSON.stringify(entries));
  return indexPath;
}

async function withTempDir(fn: (root: string) => Promise<void>): Promise<void> {
  const root = await Deno.makeTempDir();
  try {
    await fn(root);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
}

async function writeNValidSnapshots(snapshotRoot: string, count: number): Promise<ICalibrationSourceIndexEntry[]> {
  const entries: ICalibrationSourceIndexEntry[] = [];
  for (let i = 0; i < count; i++) {
    entries.push(
      await writeValidSnapshot(snapshotRoot, `snap-${String(i).padStart(4, "0")}.json`, {
        source_revision: `rev-${i}`,
      }),
    );
  }
  return entries;
}

// Immutable snapshots: a well-formed set of >=50 real snapshots reads and selects cleanly.

Deno.test("[CalibrationSources] reads and selects from a well-formed set of 50 real snapshots", async () => {
  await withTempDir(async (root) => {
    const entries = await writeNValidSnapshots(root, 50);
    const indexPath = await writeSourceIndex(root, entries);

    const selection = await readCalibrationSources({
      sourceIndexPath: indexPath,
      snapshotRoot: root,
      seed: "seed-1",
      sampleCount: 50,
    });

    assertEquals(selection.selected.length, 50);
    assertEquals(selection.excluded.length, 0);
    assertEquals(new Set(selection.selected.map((item) => item.id)).size, 50);
  });
});

Deno.test("[CalibrationSources] does not reconstruct evidence — a missing snapshot file is excluded, not synthesized", async () => {
  await withTempDir(async (root) => {
    const entries = await writeNValidSnapshots(root, 50);
    entries.push({
      run_id: "run-missing",
      step_id: "step-missing",
      snapshot_path: "does-not-exist.json",
      snapshot_hash: "0".repeat(64),
    });
    const indexPath = await writeSourceIndex(root, entries);

    const selection = await readCalibrationSources({
      sourceIndexPath: indexPath,
      snapshotRoot: root,
      seed: "seed-1",
      sampleCount: 50,
    });

    assertEquals(selection.selected.some((item) => item.id === "0".repeat(64)), false);
    assertEquals(
      selection.excluded.some((entry) => entry.id === "0".repeat(64) && entry.reason === "snapshot-not-found"),
      true,
    );
  });
});

// Missing context

Deno.test("[CalibrationSources] excludes a snapshot with empty rubric_methodology as missing-context", async () => {
  await withTempDir(async (root) => {
    const valid = await writeNValidSnapshots(root, 50);
    const broken = await writeValidSnapshot(root, "broken.json", { rubric_methodology: "" });
    const indexPath = await writeSourceIndex(root, [...valid, broken]);

    const selection = await readCalibrationSources({
      sourceIndexPath: indexPath,
      snapshotRoot: root,
      seed: "seed-1",
      sampleCount: 50,
    });

    assertEquals(selection.excluded.some((entry) => entry.id === broken.snapshot_hash), true);
    const brokenExclusion = selection.excluded.find((entry) => entry.id === broken.snapshot_hash);
    assertEquals(brokenExclusion?.reason, "missing-context");
  });
});

Deno.test("[CalibrationSources] excludes a snapshot with real_run_marker: false as missing-context", async () => {
  await withTempDir(async (root) => {
    const valid = await writeNValidSnapshots(root, 50);
    const text = JSON.stringify({ ...defaultSnapshot(), real_run_marker: false });
    const broken = await writeSnapshotText(root, "not-real.json", text);
    const indexPath = await writeSourceIndex(root, [...valid, broken]);

    const selection = await readCalibrationSources({
      sourceIndexPath: indexPath,
      snapshotRoot: root,
      seed: "seed-1",
      sampleCount: 50,
    });

    const exclusion = selection.excluded.find((entry) => entry.id === broken.snapshot_hash);
    assertEquals(exclusion?.reason, "missing-context");
  });
});

// Duplicate IDs

Deno.test("[CalibrationSources] deduplicates a repeated snapshot_hash — the second entry is excluded", async () => {
  await withTempDir(async (root) => {
    const valid = await writeNValidSnapshots(root, 49);
    const first = await writeValidSnapshot(root, "dup-a.json", { source_revision: "dup" });
    // Same content -> same hash, so this is a genuine duplicate id, not just a duplicate path.
    const duplicateText = await Deno.readTextFile(join(root, "dup-a.json"));
    const second = await writeSnapshotText(root, "dup-b.json", duplicateText);
    assertEquals(first.snapshot_hash, second.snapshot_hash);

    const indexPath = await writeSourceIndex(root, [...valid, first, second]);

    const selection = await readCalibrationSources({
      sourceIndexPath: indexPath,
      snapshotRoot: root,
      seed: "seed-1",
      sampleCount: 50,
    });

    const idOccurrences = selection.selected.filter((item) => item.id === first.snapshot_hash).length;
    assertEquals(idOccurrences, 1);
    assertEquals(
      selection.excluded.some((entry) => entry.id === first.snapshot_hash && entry.reason === "duplicate-id"),
      true,
    );
  });
});

// Seeded selection

Deno.test("[CalibrationSources] seeded selection is deterministic for the same seed", async () => {
  await withTempDir(async (root) => {
    const entries = await writeNValidSnapshots(root, 60);
    const indexPath = await writeSourceIndex(root, entries);

    const first = await readCalibrationSources({
      sourceIndexPath: indexPath,
      snapshotRoot: root,
      seed: "fixed-seed",
      sampleCount: 50,
    });
    const second = await readCalibrationSources({
      sourceIndexPath: indexPath,
      snapshotRoot: root,
      seed: "fixed-seed",
      sampleCount: 50,
    });

    assertEquals(first.selected.map((item) => item.id), second.selected.map((item) => item.id));
    assertEquals(first.selected.length, 50);
    assertEquals(first.excluded.filter((entry) => entry.reason === "not-selected").length, 10);
  });
});

Deno.test("[CalibrationSources] a different seed changes the selected sample", async () => {
  await withTempDir(async (root) => {
    const entries = await writeNValidSnapshots(root, 60);
    const indexPath = await writeSourceIndex(root, entries);

    const first = await readCalibrationSources({
      sourceIndexPath: indexPath,
      snapshotRoot: root,
      seed: "seed-a",
      sampleCount: 50,
    });
    const second = await readCalibrationSources({
      sourceIndexPath: indexPath,
      snapshotRoot: root,
      seed: "seed-b",
      sampleCount: 50,
    });

    assertEquals(
      first.selected.map((item) => item.id).join(",") !== second.selected.map((item) => item.id).join(","),
      true,
    );
  });
});

// Fewer than the configured minimum

Deno.test("[CalibrationSources] throws with an exact count when fewer than the minimum are eligible", async () => {
  await withTempDir(async (root) => {
    const entries = await writeNValidSnapshots(root, 3);
    const indexPath = await writeSourceIndex(root, entries);

    await assertRejects(
      () =>
        readCalibrationSources({
          sourceIndexPath: indexPath,
          snapshotRoot: root,
          seed: "seed-1",
          sampleCount: 50,
        }),
      CalibrationSourceError,
      "Only 3 eligible",
    );
  });
});

// Rejecting an escaping snapshot_path (the reader's "never publish an unsafe item")

Deno.test("[CalibrationSources] excludes an entry whose snapshot_path escapes the snapshot root", async () => {
  await withTempDir(async (root) => {
    const valid = await writeNValidSnapshots(root, 50);
    const outside: ICalibrationSourceIndexEntry = {
      run_id: "run-escape",
      step_id: "step-escape",
      snapshot_path: "../escape.json",
      snapshot_hash: "1".repeat(64),
    };
    const indexPath = await writeSourceIndex(root, [...valid, outside]);

    const selection = await readCalibrationSources({
      sourceIndexPath: indexPath,
      snapshotRoot: root,
      seed: "seed-1",
      sampleCount: 50,
    });

    assertEquals(selection.selected.some((item) => item.id === "1".repeat(64)), false);
    assertEquals(
      selection.excluded.some((entry) => entry.id === "1".repeat(64) && entry.reason === "invalid-snapshot"),
      true,
    );
  });
});

// Text redaction

Deno.test("[CalibrationSources][security] redacts a value sourced from a secret-named env var", () => {
  const redacted = redactCalibrationSnapshot("the token is sk-abcdefgh12345678 in this log", {
    MY_API_TOKEN: "sk-abcdefgh12345678",
  });
  assertEquals(redacted.includes("sk-abcdefgh12345678"), false);
  assertEquals(redacted.includes("[REDACTED]"), true);
});

Deno.test("[CalibrationSources][security] redacts a PEM private key block", () => {
  const pem = "-----BEGIN RSA PRIVATE KEY-----\nMIIBOgIBAAJBAK...\n-----END RSA PRIVATE KEY-----";
  const redacted = redactCalibrationSnapshot(`context around it\n${pem}\nmore context`, {});
  assertEquals(redacted.includes("BEGIN RSA PRIVATE KEY"), false);
  assertEquals(redacted.includes("[REDACTED]"), true);
});

Deno.test("[CalibrationSources][security] redacts an Authorization header value", () => {
  const redacted = redactCalibrationSnapshot("Authorization: Bearer abc.def.ghi", {});
  assertEquals(redacted.includes("abc.def.ghi"), false);
});

Deno.test("[CalibrationSources][security] rejects a credential URL userinfo that survives redaction", () => {
  assertThrows(
    () => redactCalibrationSnapshot("fetch from https://user:hunter2@example.com/api", {}),
    CalibrationRedactionError,
  );
});

Deno.test("[CalibrationSources][security] rejects an unresolved password assignment", () => {
  assertThrows(
    () => redactCalibrationSnapshot('password: "hardcoded123"', {}),
    CalibrationRedactionError,
  );
});

Deno.test("[CalibrationSources][security] leaves ordinary text untouched", () => {
  const text = "This plan adds a caching layer to the request pipeline.";
  assertEquals(redactCalibrationSnapshot(text, {}), text);
});
