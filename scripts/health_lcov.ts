#!/usr/bin/env -S deno run -A
/**
 * @module HealthLcov
 * @path scripts/health_lcov.ts
 * @description Runs selected tests with fresh LCOV data before the Exaix health report.
 * @architectural-layer Tooling
 * @related-files [scripts/measure_coverage.ts, tests/scripts/health_lcov_task_test.ts]
 *
 * Usage:
 *   deno task health:lcov <test-file-or-directory> [...]
 */

import { fromFileUrl, join } from "@std/path";

const ROOT = fromFileUrl(new URL("../", import.meta.url));
const LCOV_PATH = join(ROOT, "coverage", "lcov.info");
const SCRATCH_ROOT = join(ROOT, "..", "exaix-sandboxes");
const LCOV_INCLUDE = "^file://.*/(src|packages)/";
const LCOV_EXCLUDE = "test\\.(ts|js)$";

/** Runs a Deno command from the repository root and returns its exit code. */
async function run(args: readonly string[], env: Record<string, string> = {}): Promise<number> {
  const status = await new Deno.Command("deno", {
    args: [...args],
    cwd: ROOT,
    env,
    stdout: "inherit",
    stderr: "inherit",
  }).spawn().status;
  return status.code;
}

/** Collects coverage only from a passing selected test run, then reports it. */
async function runHealthLcov(testPaths: readonly string[]): Promise<number> {
  if (testPaths.length === 0) {
    console.error("usage: deno task health:lcov <test-file-or-directory> [...]");
    return 2;
  }
  await Deno.mkdir(join(ROOT, "coverage"), { recursive: true });
  try {
    await Deno.remove(LCOV_PATH);
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
  await Deno.mkdir(SCRATCH_ROOT, { recursive: true });
  const raw = await Deno.makeTempDir({ dir: SCRATCH_ROOT, prefix: "health-lcov-" });
  try {
    const tested = await run(["test", "--allow-all", "--reporter=dot", `--coverage=${raw}`, ...testPaths], {
      CI: "true",
    });
    if (tested !== 0) return tested;
    const converted = await run([
      "coverage",
      raw,
      `--include=${LCOV_INCLUDE}`,
      `--exclude=${LCOV_EXCLUDE}`,
      "--lcov",
      `--output=${LCOV_PATH}`,
    ]);
    if (converted !== 0) return converted;
    return await run(["task", "health", "--coverage=coverage/lcov.info"]);
  } finally {
    await Deno.remove(raw, { recursive: true });
  }
}

if (import.meta.main) Deno.exit(await runHealthLcov(Deno.args));
