/**
 * @module ManifestIntegrityTest
 * @path tests/scripts/manifest_integrity_test.ts
 * @description Validates batchIngestTerminalBench against a frozen 3-task synthetic
 *   upstream "release" (Phase 144 Step 3): the classifier + license gate correctly split
 *   supported / unsupported / license-ineligible; the written manifest.json agrees 1:1
 *   with the vendored contract dirs and generated scenario/request-fixture files; coverage
 *   math is exact. ci-core: no docker, no network — purely file-based batch ingest.
 * @architectural-layer Test
 * @related-files [scripts/ingest_terminal_bench.ts, tests/scripts/classifier_test.ts]
 */

import { assert, assertEquals, assertFalse } from "@std/assert";
import { join } from "@std/path";
import { batchIngestTerminalBench, MIN_SUPPORTED_COVERAGE_PCT } from "../../scripts/ingest_terminal_bench.ts";

const UPSTREAM_ROOT = new URL("./fixtures/terminal_bench_upstream_release", import.meta.url).pathname;
const ALLOWLISTED_LICENSE_TEXT = "MIT License\n\nPermission is hereby granted, free of charge...";
const BENCHMARK_VERSION = "d28711d0da2675d0bb1d56de45ae5df6082438a3";

async function pathExists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
}

async function withBatchTempDirs<T>(
  fn: (dirs: {
    outFixturesDir: string;
    outPortalsDir: string;
    outScenariosDir: string;
    outRequestsDir: string;
  }) => Promise<T>,
): Promise<T> {
  const outFixturesDir = await Deno.makeTempDir({ prefix: "exaix-tb-batch-fixtures-" });
  const outPortalsDir = await Deno.makeTempDir({ prefix: "exaix-tb-batch-portals-" });
  const outScenariosDir = await Deno.makeTempDir({ prefix: "exaix-tb-batch-scenarios-" });
  const outRequestsDir = await Deno.makeTempDir({ prefix: "exaix-tb-batch-requests-" });
  try {
    return await fn({ outFixturesDir, outPortalsDir, outScenariosDir, outRequestsDir });
  } finally {
    await Deno.remove(outFixturesDir, { recursive: true });
    await Deno.remove(outPortalsDir, { recursive: true });
    await Deno.remove(outScenariosDir, { recursive: true });
    await Deno.remove(outRequestsDir, { recursive: true });
  }
}

Deno.test("[ManifestIntegrity] classifies alpha=supported, beta=unsupported (multi-container), gamma=license-ineligible", async () => {
  await withBatchTempDirs(async (dirs) => {
    const manifest = await batchIngestTerminalBench({
      upstreamRoot: UPSTREAM_ROOT,
      benchmarkVersion: BENCHMARK_VERSION,
      rootLicenseText: ALLOWLISTED_LICENSE_TEXT,
      ...dirs,
    });

    const byId = new Map(manifest.tasks.map((t) => [t.task_id, t]));
    assertEquals(byId.get("alpha-task")?.class, "supported");
    assertEquals(byId.get("beta-task")?.class, "unsupported");
    assertEquals(byId.get("beta-task")?.reason, "multi-container");
    assertEquals(byId.get("gamma-task")?.class, "license-ineligible");
  });
});

Deno.test("[ManifestIntegrity] manifest.json is written to outFixturesDir and agrees with the tasks array", async () => {
  await withBatchTempDirs(async (dirs) => {
    const manifest = await batchIngestTerminalBench({
      upstreamRoot: UPSTREAM_ROOT,
      benchmarkVersion: BENCHMARK_VERSION,
      rootLicenseText: ALLOWLISTED_LICENSE_TEXT,
      ...dirs,
    });

    const manifestOnDisk = JSON.parse(await Deno.readTextFile(join(dirs.outFixturesDir, "manifest.json")));
    assertEquals(manifestOnDisk.tasks.length, manifest.tasks.length);
    assertEquals(manifestOnDisk.benchmark_version, BENCHMARK_VERSION);
  });
});

Deno.test("[ManifestIntegrity] coverage math is exact: supported_count / total_tasks", async () => {
  await withBatchTempDirs(async (dirs) => {
    const manifest = await batchIngestTerminalBench({
      upstreamRoot: UPSTREAM_ROOT,
      benchmarkVersion: BENCHMARK_VERSION,
      rootLicenseText: ALLOWLISTED_LICENSE_TEXT,
      ...dirs,
    });

    assertEquals(manifest.total_tasks, 3);
    assertEquals(manifest.supported_count, 1);
    assertEquals(manifest.coverage_pct, 1 / 3 * 100);
  });
});

Deno.test("[ManifestIntegrity] a contract dir + scenario + request fixture exist ONLY for the supported task", async () => {
  await withBatchTempDirs(async (dirs) => {
    await batchIngestTerminalBench({
      upstreamRoot: UPSTREAM_ROOT,
      benchmarkVersion: BENCHMARK_VERSION,
      rootLicenseText: ALLOWLISTED_LICENSE_TEXT,
      ...dirs,
    });

    assert(await pathExists(join(dirs.outFixturesDir, "alpha-task", "task.json")), "alpha-task contract must exist");
    assert(await pathExists(join(dirs.outScenariosDir, "alpha-task.yaml")), "alpha-task scenario must exist");
    assert(await pathExists(join(dirs.outRequestsDir, "alpha-task.md")), "alpha-task request fixture must exist");

    assertFalse(
      await pathExists(join(dirs.outFixturesDir, "beta-task")),
      "beta-task (unsupported) must not be vendored",
    );
    assertFalse(await pathExists(join(dirs.outScenariosDir, "beta-task.yaml")), "beta-task must have no scenario");
    assertFalse(
      await pathExists(join(dirs.outFixturesDir, "gamma-task")),
      "gamma-task (license-ineligible) must not be vendored",
    );
    assertFalse(await pathExists(join(dirs.outScenariosDir, "gamma-task.yaml")), "gamma-task must have no scenario");
  });
});

Deno.test("[ManifestIntegrity] the generated scenario yaml renders the external_terminal_bench pack with the docker tag", async () => {
  await withBatchTempDirs(async (dirs) => {
    await batchIngestTerminalBench({
      upstreamRoot: UPSTREAM_ROOT,
      benchmarkVersion: BENCHMARK_VERSION,
      rootLicenseText: ALLOWLISTED_LICENSE_TEXT,
      ...dirs,
    });

    const yaml = await Deno.readTextFile(join(dirs.outScenariosDir, "alpha-task.yaml"));
    assert(yaml.includes('pack: "external_terminal_bench"'));
    assert(yaml.includes('"docker"'));
  });
});

Deno.test("[ManifestIntegrity] MIN_SUPPORTED_COVERAGE_PCT is a sensible published constant", () => {
  assert(MIN_SUPPORTED_COVERAGE_PCT > 0);
  assert(MIN_SUPPORTED_COVERAGE_PCT <= 100);
});
