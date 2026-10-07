#!/usr/bin/env -S deno run -A
/**
 * @module TestContainerDriver
 * @path scripts/test_container_driver.ts
 * @description In-container driver for the Phase 207 Batch-2 worker. It reads one repo-relative
 *   test file per line from stdin and runs each in a fresh `deno test` subprocess, so no two
 *   files share a process environment. It enforces a per-file timeout, kills the file's process
 *   group and reaps leftover daemons after every file, tees output to stderr, and writes one
 *   result line to stdout. It never passes more than one file to a `deno test` invocation.
 * Usage:
 *   Runs inside the `dev-test` worker container: `deno run --allow-all scripts/test_container_driver.ts`.
 *   The host writes repo-relative file paths (or the DONE sentinel) to stdin, one per line.
 * @architectural-layer Tooling
 * @dependencies [@std/streams, scripts/test_output_parse.ts]
 * @related-files [scripts/test_isolation.ts, scripts/test_output_parse.ts]
 */

import { TextLineStream } from "@std/streams";
import { parseDotReporterCounts, parseSummaryLine } from "./test_output_parse.ts";

/** One finished file's counts, emitted by the driver and consumed by the host. */
export interface IContainerRunResult {
  testFile: string;
  passed: number;
  failed: number;
  ignored: number;
  durationSec: number;
  exitCode: number;
  failureDetail: string | null;
}

/** A spawned `deno test` child the driver can await and kill. */
export interface IDriverChild {
  pid: number;
  output(): Promise<{ code: number; stdout: Uint8Array; stderr: Uint8Array }>;
}

/** Injectable seams for the driver. the real values are wired in `import.meta.main`. */
export interface IContainerDriverDeps {
  repoRoot: string;
  spawn: (file: string) => IDriverChild;
  killGroup: (pid: number) => void;
  reap: () => Promise<void>;
  timeoutMs: number;
  now: () => number;
  writeLog: (text: string) => void;
  writeResult: (result: IContainerRunResult) => void;
}

/** stdin line that tells the driver to exit cleanly. */
export const TEST_CONTAINER_DONE_SENTINEL = "__EXA_DONE__";
/** stdout line prefix for one result. stdout carries nothing else. */
export const TEST_CONTAINER_RESULT_PREFIX = "__EXA_TEST_RESULT__ ";
/** Exit code reported when a file exceeds its per-file timeout. */
export const TEST_CONTAINER_TIMEOUT_EXIT_CODE = 124;
/** Cap on the failure detail carried in a result line. */
export const TEST_CONTAINER_FAILURE_DETAIL_MAX_CHARS = 4000;
/** Per-file timeout. the driver kills the file's process group at this bound. */
export const DEFAULT_TEST_CONTAINER_TIMEOUT_MS = 10 * 60 * 1000;

const DAEMON_PATTERN = "daemon/main.ts";
const REPORTER_FLAG = "--reporter=dot";
const TEST_SUBCOMMAND = "test";
const ALLOW_ALL_FLAG = "--allow-all";

/** True when `file` is a repo-relative path that stays inside `repoRoot` (no absolute path, no `..`). */
export function isRepoRelativeTestFile(file: string, repoRoot: string): boolean {
  if (file.length === 0 || file.startsWith("/") || file.includes("..")) return false;
  const resolved = new URL(file, `file://${repoRoot}/`).pathname;
  return resolved.startsWith(`${repoRoot.replace(/\/$/, "")}/`);
}

/** Combine stdout and stderr into one buffer for parsing. */
function concatOutput(stdout: Uint8Array, stderr: Uint8Array): Uint8Array {
  const combined = new Uint8Array(stdout.length + stderr.length);
  combined.set(stdout, 0);
  combined.set(stderr, stdout.length);
  return combined;
}

/** Truncate `text` to `max` characters, keeping the tail (the failure message). */
function truncateTail(text: string, max: number): string {
  return text.length <= max ? text : text.slice(text.length - max);
}

/** Run one file in a fresh subprocess, enforce the timeout, kill the group, and reap leftovers. */
export async function processFile(file: string, deps: IContainerDriverDeps): Promise<IContainerRunResult> {
  const startedAt = deps.now();
  const child = deps.spawn(file);
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    deps.killGroup(child.pid);
  }, deps.timeoutMs);

  let code = 1;
  let combined: Uint8Array = new Uint8Array();
  try {
    const out = await child.output();
    code = out.code;
    combined = concatOutput(out.stdout, out.stderr);
  } catch {
    code = 1;
  } finally {
    clearTimeout(timer);
    deps.killGroup(child.pid);
    await deps.reap();
  }

  const text = new TextDecoder().decode(combined);
  deps.writeLog(text);

  const summary = parseSummaryLine(text);
  const counts = summary.passed === 0 && summary.failed === 0
    ? parseDotReporterCounts(text, summary.durationSec)
    : summary;
  const exitCode = timedOut ? TEST_CONTAINER_TIMEOUT_EXIT_CODE : code;
  const durationSec = Math.max(0, Math.floor((deps.now() - startedAt) / 1000));

  return {
    testFile: file,
    passed: counts.passed,
    failed: counts.failed,
    ignored: counts.ignored,
    durationSec,
    exitCode,
    failureDetail: exitCode === 0
      ? null
      : (timedOut ? "timeout" : truncateTail(text, TEST_CONTAINER_FAILURE_DETAIL_MAX_CHARS)),
  };
}

/** Read file paths from `lines` until the DONE sentinel. process each and emit its result. */
export async function runDriverLoop(
  lines: AsyncIterable<string>,
  deps: IContainerDriverDeps,
): Promise<void> {
  for await (const rawLine of lines) {
    const file = rawLine.trim();
    if (file.length === 0) continue;
    if (file === TEST_CONTAINER_DONE_SENTINEL) return;
    if (!isRepoRelativeTestFile(file, deps.repoRoot)) {
      deps.writeResult({
        testFile: file,
        passed: 0,
        failed: 0,
        ignored: 0,
        durationSec: 0,
        exitCode: 1,
        failureDetail: "invalid test file path",
      });
      continue;
    }
    deps.writeResult(await processFile(file, deps));
  }
}

/** Real spawn: a fresh `deno test` in its own process group. */
function realSpawn(file: string, repoRoot: string): IDriverChild {
  const child = new Deno.Command(Deno.execPath(), {
    args: [TEST_SUBCOMMAND, ALLOW_ALL_FLAG, REPORTER_FLAG, file],
    cwd: repoRoot,
    stdout: "piped",
    stderr: "piped",
    detached: true,
  }).spawn();
  return { pid: child.pid, output: () => child.output() };
}

/** Real group kill: negative pid targets the child's whole process group. */
function realKillGroup(pid: number): void {
  try {
    Deno.kill(-pid, "SIGKILL");
  } catch {
    // already dead, or not a group leader (non-Linux) — nothing to signal
  }
}

/** Real reap: kill any daemon a test left behind (procps `pkill`, installed in the image). */
async function realReap(): Promise<void> {
  try {
    await new Deno.Command("pkill", {
      args: ["-f", DAEMON_PATTERN],
      stdout: "null",
      stderr: "null",
    }).output();
  } catch {
    // pkill absent or nothing matched — the process-group kill already covered the common case
  }
}

if (import.meta.main) {
  const repoRoot = Deno.cwd();
  const encoder = new TextEncoder();
  const lines = Deno.stdin.readable
    .pipeThrough(new TextDecoderStream())
    .pipeThrough(new TextLineStream());
  await runDriverLoop(lines, {
    repoRoot,
    spawn: (file) => realSpawn(file, repoRoot),
    killGroup: realKillGroup,
    reap: realReap,
    timeoutMs: DEFAULT_TEST_CONTAINER_TIMEOUT_MS,
    now: () => Date.now(),
    writeLog: (text) => Deno.stderr.writeSync(encoder.encode(text)),
    writeResult: (result) =>
      Deno.stdout.writeSync(encoder.encode(`${TEST_CONTAINER_RESULT_PREFIX}${JSON.stringify(result)}\n`)),
  });
}
