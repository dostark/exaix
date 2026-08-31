#!/usr/bin/env -S deno run -A
/**
 * @module SweepTerminalBenchControls
 * @path scripts/sweep_terminal_bench_controls.ts
 * @description Docker-gated, operator-run null + reference controls sweep over the
 *   `supported` subset of a batch-ingested Terminal-Bench manifest.json (Phase 144 Step 3).
 *   For each `supported` entry, runs the vendored `scoped_test_cmd` inside the real
 *   eval-jail container against the unmodified portal (null control — must FAIL) and the
 *   portal with `reference.patch` applied via a synthetic base commit (reference control —
 *   must PASS), then writes `controls_status` back into manifest.json. Docker absence is a
 *   structured SKIP (`docker-unavailable` on every entry), never a throw. Never spends
 *   provider tokens (verify-only, no delegate step).
 * Usage:
 *   deno run -A scripts/sweep_terminal_bench_controls.ts --manifest <path>
 *     --fixtures-dir <dir> --portals-dir <dir> [--concurrency <n>]
 * @related-files [scripts/ingest_terminal_bench.ts, tests/scenario_framework/runner/matrix_expander.ts]
 */

import { join, resolve } from "@std/path";
import { copy } from "@std/fs";
import type { Opt, Reason } from "@exaix/core/types";
import { buildJailLaunch, dockerProbeSkipReason } from "../tests/scenario_framework/runner/matrix_expander.ts";
import { DEFAULT_ORACLE_SOLUTION_TIMEOUT_MS } from "./ingest_terminal_bench.ts";
import type { IManifest, IManifestTaskEntry } from "./ingest_terminal_bench.ts";

interface ISweepCliArgs {
  manifestPath: string;
  fixturesDir: string;
  portalsDir: string;
  concurrency: number;
}

const DEFAULT_CONCURRENCY = 4;
/** Git identity for the synthetic pre-reference commit (mirrors ingest's own SYNTHETIC_COMMIT_*). */
const SWEEP_GIT_EMAIL = "external-bench-ingest@exaix.dev";
const SWEEP_GIT_NAME = "external-bench-ingest";

// Runs `bin` with `args`, killed at `timeoutMs` (default matches
// `DEFAULT_ORACLE_SOLUTION_TIMEOUT_MS`, the same bound the dockerless oracle-solution apply
// uses). Never throws on timeout: returns a non-zero, diagnosable result instead.
export async function runCommand(
  bin: string,
  args: string[],
  cwd?: Opt<string, Reason.OptionalContext>,
  timeoutMs: number = DEFAULT_ORACLE_SOLUTION_TIMEOUT_MS,
): Promise<{ code: number; stderr: string }> {
  const command = new Deno.Command(bin, {
    args,
    cwd,
    stdout: "piped",
    stderr: "piped",
    signal: AbortSignal.timeout(timeoutMs),
  });
  try {
    const output = await command.output();
    if (output.signal !== null) {
      // Deno.Command resolves (never rejects) when the abort signal kills the process —
      // confirmed empirically: `success: false, signal: "SIGTERM"`, no thrown error.
      return { code: output.code, stderr: `verify timed out after ${timeoutMs}ms (killed by ${output.signal})` };
    }
    return { code: output.code, stderr: new TextDecoder().decode(output.stderr) };
  } catch (error) {
    // Defense in depth: some Deno versions/spawn failures may reject instead of resolving.
    return {
      code: 1,
      stderr: `verify timed out after ${timeoutMs}ms: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

// Runs one control (null or reference) for a task, using the same verify-only launch shape
// as `renderExternalBenchTaskTemplate`'s verify step. Returns whether the verify command
// exited 0.
async function runControl(
  options: {
    taskId: string;
    portalSourceDir: string;
    oracleTestsSourceDir: string;
    scopedTestCmd: string;
    applyReference: boolean;
    referencePatchPath: string;
  },
): Promise<{ passed: boolean; detail: string }> {
  const workDir = await Deno.makeTempDir({ prefix: `exaix-tb-sweep-${options.taskId}-` });
  try {
    await copy(options.portalSourceDir, workDir, { overwrite: true });
    if (options.applyReference) {
      const patchText = await Deno.readTextFile(options.referencePatchPath);
      if (patchText.trim().length === 0) {
        return { passed: false, detail: "reference.patch is empty — oracle solution produced no diff" };
      }
      const init = await runCommand("git", ["init", "-q"], workDir);
      if (init.code !== 0) return { passed: false, detail: `git init failed: ${init.stderr}` };
      await runCommand("git", ["add", "-A"], workDir);
      await runCommand(
        "git",
        [
          "-c",
          `user.email=${SWEEP_GIT_EMAIL}`,
          "-c",
          `user.name=${SWEEP_GIT_NAME}`,
          "commit",
          "-q",
          "-m",
          "pre-reference",
          "--allow-empty",
        ],
        workDir,
      );
      const applyPatchPath = join(workDir, ".sweep-reference.patch");
      await Deno.writeTextFile(applyPatchPath, patchText);
      const apply = await runCommand("git", ["apply", applyPatchPath], workDir);
      if (apply.code !== 0) return { passed: false, detail: `git apply reference.patch failed: ${apply.stderr}` };
    }

    const jailed = buildJailLaunch({ bin: "bash", args: ["-c", options.scopedTestCmd] }, {
      mountSource: workDir,
      mountDest: "/app",
      workdir: "/app",
      extraMounts: [`type=bind,src=${options.oracleTestsSourceDir},dst=/oracle_tests,ro`],
    });
    const run = await runCommand(jailed.bin, jailed.args);
    const stderrTail = run.stderr.trim().slice(-500);
    return {
      passed: run.code === 0,
      detail: run.code === 0
        ? "verify exited 0"
        : `verify exited ${run.code}${stderrTail ? ` — stderr: ${stderrTail}` : ""}`,
    };
  } finally {
    await Deno.remove(workDir, { recursive: true });
  }
}

// One supported task's full null+reference control outcome. Contains any thrown error as a
// `sweep-error` result instead of propagating it, mirroring `ingestOneBatchTask`'s per-task
// containment so one corrupted task never discards the rest of the sweep's results.
export async function sweepTask(
  entry: IManifestTaskEntry,
  fixturesDir: string,
  portalsDir: string,
): Promise<{ taskId: string; status: IManifestTaskEntry["controls_status"]; detail: string }> {
  try {
    const contractDir = join(fixturesDir, entry.task_id);
    const taskJson: { scoped_test_cmd: string } = JSON.parse(
      await Deno.readTextFile(join(contractDir, "task.json")),
    );
    const portalSourceDir = join(portalsDir, entry.task_id);
    const oracleTestsSourceDir = join(contractDir, "oracle_tests");
    const referencePatchPath = join(contractDir, "reference.patch");

    const nullResult = await runControl({
      taskId: entry.task_id,
      portalSourceDir,
      oracleTestsSourceDir,
      scopedTestCmd: taskJson.scoped_test_cmd,
      applyReference: false,
      referencePatchPath,
    });
    if (nullResult.passed) {
      return {
        taskId: entry.task_id,
        status: "fail",
        detail:
          `null control unexpectedly PASSED (verify criterion is trivially satisfiable without the oracle solution): ${nullResult.detail}`,
      };
    }

    const referenceResult = await runControl({
      taskId: entry.task_id,
      portalSourceDir,
      oracleTestsSourceDir,
      scopedTestCmd: taskJson.scoped_test_cmd,
      applyReference: true,
      referencePatchPath,
    });
    if (!referenceResult.passed) {
      return {
        taskId: entry.task_id,
        status: "fail",
        detail:
          `reference control unexpectedly FAILED (oracle solution does not satisfy its own verify criterion): ${referenceResult.detail}`,
      };
    }

    return { taskId: entry.task_id, status: "pass", detail: "null fails, reference passes" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { taskId: entry.task_id, status: "fail", detail: `sweep-error: ${message}` };
  }
}

/** Runs `tasks` with at most `concurrency` in flight at once, preserving input order in the result array. */
async function runWithConcurrency<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  async function worker(): Promise<void> {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      results[index] = await fn(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

function parseArgs(argv: string[]): ISweepCliArgs {
  const flags: Record<string, string> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg.startsWith("--")) {
      flags[arg.slice(2)] = argv[index + 1];
      index += 1;
    }
  }
  const manifestPath = flags["manifest"];
  const fixturesDir = flags["fixtures-dir"];
  const portalsDir = flags["portals-dir"];
  if (!manifestPath || !fixturesDir || !portalsDir) {
    throw new Error(
      "Usage: --manifest <path> --fixtures-dir <dir> --portals-dir <dir> [--concurrency <n>]",
    );
  }
  return {
    manifestPath: resolve(manifestPath),
    // docker --mount requires an absolute src path — a relative --fixtures-dir/--portals-dir
    // (the natural way to invoke this script from the repo root) otherwise fails at the
    // daemon with "invalid mount path ... must be absolute".
    fixturesDir: resolve(fixturesDir),
    portalsDir: resolve(portalsDir),
    concurrency: flags["concurrency"] ? Number.parseInt(flags["concurrency"], 10) : DEFAULT_CONCURRENCY,
  };
}

async function main(): Promise<void> {
  const args = parseArgs(Deno.args);
  const manifest: IManifest = JSON.parse(await Deno.readTextFile(args.manifestPath));

  const skipReason = dockerProbeSkipReason();
  if (skipReason !== null) {
    console.log(`SKIPPED (docker-unavailable): ${skipReason}`);
    for (const task of manifest.tasks) {
      if (task.class === "supported") task.controls_status = "docker-unavailable";
    }
    await Deno.writeTextFile(args.manifestPath, JSON.stringify(manifest, null, 2) + "\n");
    return;
  }

  const supportedTasks = manifest.tasks.filter((task) => task.class === "supported");
  console.log(`Sweeping controls for ${supportedTasks.length} supported task(s), concurrency=${args.concurrency}...`);

  const outcomes = await runWithConcurrency(
    supportedTasks,
    args.concurrency,
    (task) => sweepTask(task, args.fixturesDir, args.portalsDir),
  );

  const byTaskId = new Map(outcomes.map((outcome) => [outcome.taskId, outcome]));
  for (const task of manifest.tasks) {
    const outcome = byTaskId.get(task.task_id);
    if (!outcome) continue;
    task.controls_status = outcome.status;
    console.log(`${outcome.status === "pass" ? "PASS" : "FAIL"} ${outcome.taskId}: ${outcome.detail}`);
  }

  await Deno.writeTextFile(args.manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  const passCount = outcomes.filter((outcome) => outcome.status === "pass").length;
  console.log(`Controls sweep complete: ${passCount}/${outcomes.length} passed.`);
}

if (import.meta.main) {
  await main();
}
