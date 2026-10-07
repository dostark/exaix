#!/usr/bin/env -S deno run -A
/**
 * @module VerifyBatch2ContainerCutover
 * @path scripts/verify_batch2_container_cutover.ts
 * @description Manual verification of the Phase 207 containerized Batch-2 runner. It times
 *   Batch 2 in container mode and in serial mode, compares the per-file pass/fail/ignored
 *   counts, and fails when the counts differ or the wall-clock drop is below 50%. It is NOT
 *   part of the test suite; run it on a booted dev host with Docker.
 * Usage:
 *   deno run --allow-run --allow-read --allow-env --allow-write --allow-ffi --allow-sys \
 *     scripts/verify_batch2_container_cutover.ts [--jobs N]
 * @architectural-layer Tooling
 * @dependencies [scripts/test_isolation.ts, scripts/test_parallel.ts, scripts/test_container_driver.ts]
 * @related-files [.github/workflows/code-quality.yml, tests/scripts/test_isolation_test.ts]
 */

import { fromFileUrl } from "@std/path";
import {
  DEFAULT_TEST_CONTAINER_IMAGE,
  DEFAULT_TEST_CONTAINER_NETWORK,
  DEFAULT_TEST_CONTAINER_WATCHDOG_MS,
  ensureDevTestImage,
  resolveContainerResourceBounds,
  runBatch2InContainers,
  TEST_CONTAINER_IMAGE_ENV,
} from "./test_isolation.ts";
import { buildContainerEnv, parseDotReporterCounts, parseSummaryLine, SEQUENTIAL_TESTS } from "./test_parallel.ts";

const REPO_ROOT = fromFileUrl(new URL("..", import.meta.url)).replace(/\/$/, "");
const JOBS_FLAG = "--jobs";
const DEFAULT_JOBS = 4;
const MIN_DROP = 0.5;
const SLOWEST_REPORTED = 5;
const DAEMON_PATTERN = "daemon/main.ts";

/** One file's counts. */
interface IFileCounts {
  passed: number;
  failed: number;
  ignored: number;
}

/** Parse `--jobs <N>` / `=<N>`, defaulting to `DEFAULT_JOBS`. */
export function parseJobs(args: readonly string[]): number {
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    let raw: string | undefined;
    if (arg.startsWith(`${JOBS_FLAG}=`)) {
      raw = arg.slice(JOBS_FLAG.length + 1);
    } else if (arg === JOBS_FLAG) {
      raw = args[index + 1];
    }
    if (raw === undefined) continue;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 1) {
      throw new Error(`Invalid ${JOBS_FLAG} value "${raw}": expected an integer >= 1`);
    }
    return value;
  }
  return DEFAULT_JOBS;
}

/** Kill daemons left by a previous phase, mirroring `test_parallel.ts:main`. */
async function reapDaemons(): Promise<void> {
  try {
    await new Deno.Command("pkill", { args: ["-f", DAEMON_PATTERN], stdout: "null", stderr: "null" }).output();
    await new Promise((resolve) => setTimeout(resolve, 500));
  } catch {
    // pkill absent — ignore
  }
}

/** Run one file serially, exactly as the serial Batch-2 path does. */
async function serialCounts(file: string): Promise<IFileCounts> {
  const env = { ...Deno.env.toObject() };
  delete env["DENO_JOBS"];
  const out = await new Deno.Command(Deno.execPath(), {
    args: ["test", "--allow-all", "--reporter=dot", file],
    cwd: REPO_ROOT,
    env,
    stdout: "piped",
    stderr: "piped",
  }).output();
  const text = new TextDecoder().decode(out.stdout) + new TextDecoder().decode(out.stderr);
  const summary = parseSummaryLine(text);
  const counts = summary.passed === 0 && summary.failed === 0
    ? parseDotReporterCounts(text, summary.durationSec)
    : summary;
  return { passed: counts.passed, failed: counts.failed, ignored: counts.ignored };
}

/** Time containerized Batch 2, split into the worker pool and the host-serial network pass. */
async function runContainerBatch2(image: string, jobs: number): Promise<{
  wallSec: number;
  poolSec: number;
  networkSec: number;
  counts: Map<string, IFileCounts>;
  slowest: { file: string; durationSec: number }[];
}> {
  const bounds = resolveContainerResourceBounds(Deno.env.toObject());
  const poolStartedAt = Date.now();
  const results = await runBatch2InContainers(SEQUENTIAL_TESTS, {
    repoRoot: REPO_ROOT,
    image,
    jobs,
    env: buildContainerEnv(),
    network: DEFAULT_TEST_CONTAINER_NETWORK,
    pidsLimit: bounds.pidsLimit,
    memory: bounds.memory,
    cpus: bounds.cpus,
    watchdogMs: DEFAULT_TEST_CONTAINER_WATCHDOG_MS,
  });
  const poolSec = (Date.now() - poolStartedAt) / 1000;

  const counts = new Map<string, IFileCounts>(
    results.map((result) => [
      result.testFile,
      { passed: result.passed, failed: result.failed, ignored: result.ignored },
    ]),
  );
  const networkStartedAt = Date.now();
  for (const entry of SEQUENTIAL_TESTS.filter((test) => test.network)) {
    counts.set(entry.file, await serialCounts(entry.file));
  }
  const networkSec = (Date.now() - networkStartedAt) / 1000;

  const slowest = results
    .map((result) => ({ file: result.testFile, durationSec: result.durationSec }))
    .sort((a, b) => b.durationSec - a.durationSec)
    .slice(0, SLOWEST_REPORTED);
  return { wallSec: poolSec + networkSec, poolSec, networkSec, counts, slowest };
}

/** Time serial Batch 2 over the full list. */
async function runSerialBatch2(): Promise<{ wallSec: number; counts: Map<string, IFileCounts> }> {
  const startedAt = Date.now();
  const counts = new Map<string, IFileCounts>();
  for (const entry of SEQUENTIAL_TESTS) {
    counts.set(entry.file, await serialCounts(entry.file));
  }
  return { wallSec: (Date.now() - startedAt) / 1000, counts };
}

export async function main(args: readonly string[] = Deno.args): Promise<number> {
  const jobs = parseJobs(args);
  const image = Deno.env.get(TEST_CONTAINER_IMAGE_ENV) ?? DEFAULT_TEST_CONTAINER_IMAGE;
  await ensureDevTestImage(image);

  console.log(`› Batch 2 container cutover verification: ${jobs} worker(s), image ${image}`);
  const skipSerial = Deno.env.get("EXA_VERIFY_SKIP_SERIAL") === "1";
  const serialWallEnv = Number(Deno.env.get("EXA_VERIFY_SERIAL_WALL") ?? "");
  let serial: { wallSec: number; counts: Map<string, IFileCounts> } | undefined;
  if (skipSerial) {
    console.log("› Skipping the serial baseline (EXA_VERIFY_SKIP_SERIAL=1).");
  } else {
    console.log("› Running the serial baseline first (clean host)...");
    await reapDaemons();
    serial = await runSerialBatch2();
    console.log("› Serial baseline done.");
  }
  console.log("› Running the container batch...");
  await reapDaemons();
  const container = await runContainerBatch2(image, jobs);

  const mismatches: string[] = [];
  if (serial) {
    for (const entry of SEQUENTIAL_TESTS) {
      const c = container.counts.get(entry.file);
      const s = serial.counts.get(entry.file);
      if (!c || !s) {
        mismatches.push(`${entry.file}: missing result`);
        continue;
      }
      if (c.passed !== s.passed || c.failed !== s.failed || c.ignored !== s.ignored) {
        mismatches.push(
          `${entry.file}: container=${c.passed}/${c.failed}/${c.ignored} serial=${s.passed}/${s.failed}/${s.ignored}`,
        );
      }
    }
  }

  const serialWallSec = serial?.wallSec ?? (Number.isFinite(serialWallEnv) ? serialWallEnv : 0);
  const drop = serialWallSec > 0 ? 1 - container.wallSec / serialWallSec : 0;
  console.log("");
  console.log(`Batch 2 serial wall-clock:    ${serialWallSec.toFixed(1)}s`);
  console.log(
    `Batch 2 container wall-clock: ${container.wallSec.toFixed(1)}s (pool ${container.poolSec.toFixed(1)}s + network ${
      container.networkSec.toFixed(1)
    }s)`,
  );
  console.log(`Batch 2 wall-clock drop:      ${(drop * 100).toFixed(1)}%`);
  console.log("Slowest container files:");
  for (const entry of container.slowest) {
    console.log(`  ${entry.durationSec}s  ${entry.file}`);
  }

  if (mismatches.length > 0) {
    console.error(`\n❌ ${mismatches.length} parity mismatch(es):`);
    for (const line of mismatches) console.error(`  ${line}`);
    return 1;
  }
  if (serial) {
    console.log("\n✅ Parity: every Batch-2 file matches the serial counts.");
  }
  if (drop < MIN_DROP) {
    console.error(`❌ Wall-clock drop ${(drop * 100).toFixed(1)}% is below ${MIN_DROP * 100}%.`);
    return 1;
  }
  console.log("✅ Cutover verified.");
  return 0;
}

if (import.meta.main) {
  Deno.exit(await main());
}
