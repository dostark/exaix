#!/usr/bin/env -S deno run -A
/**
 * @module TestParallel
 * @path scripts/test_parallel.ts
 * @description Two-batch test runner that maximises parallel throughput while
 * still executing CLI-subprocess-heavy tests that are unsafe to run concurrently.
 *
 * Batch 1 – the whole test suite run with `--parallel`, at a worker count
 *            that matches the host's detected concurrency (or an explicit
 *            DENO_JOBS the caller already exported) for maximum safe speed.
 * Batch 2 – the sequential files run one after another without DENO_JOBS so
 *            their skipInParallel guards evaluate to false and every test runs.
 *
 * Usage:
 *   deno task test_parallel
 */

import { basename, fromFileUrl, join } from "@std/path";

export interface IDotReporterState {
  pendingDots: string;
  partialLine: string;
  wrapWidth: number;
}

const REPO_ROOT = join(fromFileUrl(import.meta.url), "..", "..");
const SUPPORTED_REPORTERS = ["pretty", "dot", "tap"] as const;
export const DOT_REPORTER_LEGEND = "dot legend: .=passed ,=ignored !=failed";

// Matches deno test --parallel's own default (hardwareConcurrency) rather than a
// hardcoded value: oversubscribing the host's core count causes concurrent CLI-heavy
// tests to fail spawning subprocesses transiently (observed on a 4-core WSL2 host).
const BATCH1_WORKER_COUNT = Deno.env.get("DENO_JOBS") ?? String(navigator.hardwareConcurrency);

// PIDs of running `deno test` batch children, spawned `detached` so a group-wide
// SIGTERM also reaches subprocesses they spawn (e.g. daemons booted by individual
// test files) — a child's own children are not signaled when only the child is killed.
const activeChildPids = new Set<number>();

/** `pids`/`kill` are injectable (default: real tracked set, `Deno.kill`) so this is unit-testable without spawning real processes. */
export function killActiveChildGroups(
  pids: Iterable<number> = activeChildPids,
  kill: (pid: number) => void = (pid) => Deno.kill(pid, "SIGTERM"),
): void {
  for (const pid of pids) {
    try {
      kill(-pid);
    } catch {
      // already dead, or not a process group leader (e.g. non-Linux) — nothing to signal
    }
  }
}

type TestReporter = typeof SUPPORTED_REPORTERS[number];

/** Sequential because they spawn CLI sub-processes sensitive to environment-variable cross-contamination. */
const SEQUENTIAL_FILES: string[] = [
  // Tests that launch daemon subprocesses or heavy I/O — these do not
  // parallelize safely due to Deno cache races on direct `deno run` calls
  // and resource contention from multiple concurrent daemon instances.
  "tests/scenario_framework/tests/portal_knowledge_strategies_scenario_test.ts",
  // Daemon-launching scenario: waits on daemon.ready within 30s, which loses
  // the race under DENO_JOBS parallelism (passes comfortably run sequentially).
  "apps/daemon/tests/deploy_workspace_test.ts",
  "tests/integration/cli_commands_test.ts",
  // MCP handshake test — `mock_agent.ts` hardcodes branch "feat/test" which
  // conflicts when parallel tests create branches with different names.
  "tests/integration/agent/mcp_handshake_test.ts",
  // Plan amendment scenario — starts a real daemon; port contention with
  // other daemon-launching tests in the parallel batch causes failures.
  "tests/scenario_framework/tests/plan_amendment_scenario_test.ts",
  // Config cutover daemon boot — boots a real daemon; the poll-watcher test
  // (1500ms settle + 1500ms post-inject) times out under DENO_JOBS contention.
  "tests/integration/config_cutover_daemon_boot_test.ts",
  // Integrity daemon boot — boots a real daemon and writes mid-flight config DB
  // overrides; races on Deno module cache and SQLite busy-timeout under parallel.
  "tests/integration/config_integrity_daemon_boot_test.ts",
  // Dogfood e2e — boots a real daemon and waits for plan generation; daemon
  // subprocess crashes under parallel Deno cache contention.
  "tests/integration/dogfood_e2e_test.ts",
  // Dogfood crash recovery — boots daemon twice (normal + recovery) and checks
  // journal; daemon subprocess races on module cache under parallel.
  "tests/integration/dogfood_crash_recovery_e2e_test.ts",
  // Daemon watcher readiness — boots a real daemon and asserts watcher.started /
  // daemon.ready journal events; daemon subprocess crashes under parallel.
  "tests/integration/daemon_watcher_readiness_test.ts",
  // DB migration test — runs migrate_db.ts via deno run subprocess; races on
  // the Deno module cache under parallel, yielding partial @exaix/core exports.
  "tests/migrations/migrate_db_test.ts",
  // scrubProcessEnv here deletes process-global vars like LD_LIBRARY_PATH while
  // parallel workers are snapshotting parent env for subprocess spawns, which
  // surfaced as transient "Failed to spawn 'deno'" errors in unrelated test files.
  "packages/core/tests/child_env_test.ts",
  // Test-mode schema test — uses withEnv() to delete EXA_TEST_MODE from the
  // global Deno.env; this leaks across tests under DENO_JOBS parallelism.
  "packages/storage-sqlite/tests/test_mode_schema_test.ts",
  // Rewrites the real .copilot/manifest.json in place (buildIndex() has no
  // output-path override); races with other tests reading that same file under
  // DENO_JOBS parallelism, producing truncated-JSON reads.
  "tests/agents/build_agents_index_test.ts",
  // Blueprint commands — 30 tests, each doing a full git-repo init/config spawn
  // (the highest git-subprocess density in the corpus); this file alone oversubscribes
  // spawn capacity and hits transient "Failed to spawn 'git'" even at hardwareConcurrency.
  "apps/exactl/tests/blueprint_commands_test.ts",
  // The hardened delegation test probes the real OpenCode binary. Under Batch 1 spawn
  // pressure, that probe can fail before writing its per-test permission config.
  "apps/daemon/tests/session_delegation_coordinator_test.ts",
  // Sequencing assertions advance promise-controlled steps with zero-delay timers. Heavy
  // Batch 1 event-loop pressure can delay the first dispatch past the assertion boundary.
  "packages/flow/tests/session_delegate_cycle_sequencing_test.ts",
  // DiskSpaceHealthCheck shells out to `df` per check; under Batch 1's spawn
  // contention that intermittently errors, and critical=true turns the transient
  // failure into a hard FAIL, breaking assertions expecting "pass"/"warn"/"degraded".
  "apps/daemon/tests/health_check_service_test.ts",
];

/** An explicit `--ignore` on the CLI overrides deno.json's config `exclude` for the walk, so fixtures excluded there (e.g. broken-on-purpose portal sources) must be re-listed here or they leak back into type-checking. */
const PARALLEL_IGNORE_PATHS: string[] = [
  "tests/scenario_framework/fixtures/",
];

interface TestStats {
  label: string;
  passed: number;
  failed: number;
  ignored: number;
  durationSec: number;
  exitCode: number;
}

/** Subset returned by parseSummaryLine (no label or exitCode). */
type TestCounts = Pick<TestStats, "passed" | "failed" | "ignored" | "durationSec">;

/** Subset passed to row() for rendering (everything except label). */
type TestRowData = Pick<TestStats, "passed" | "failed" | "ignored" | "durationSec" | "exitCode">;

const DOT_REPORTER_SYMBOLS_PATTERN = /^[.,!]+$/;
const DEFAULT_DOT_WRAP_WIDTH = 80;
const SUMMARY_LINE_MS_PATTERN =
  /(?:^|\n)(?:ok|FAILED)\s*\|\s*(\d+)\s+passed(?:\s*\(\d+\s+steps?\))?\s*\|\s*(\d+)\s+failed(?:\s*\(\d+\s+steps?\))?(?:\s*\|\s*(\d+)\s+ignored)?\s*\((\d+)ms\)/;
const SUMMARY_LINE_SEC_PATTERN =
  /(?:^|\n)(?:ok|FAILED)\s*\|\s*(\d+)\s+passed(?:\s*\(\d+\s+steps?\))?\s*\|\s*(\d+)\s+failed(?:\s*\(\d+\s+steps?\))?(?:\s*\|\s*(\d+)\s+ignored)?\s*\((\d+)(?:m(\d+))?s\)/;

export function resolveReporter(args: string[]): TestReporter {
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg.startsWith("--reporter=")) {
      return validateReporter(arg.slice("--reporter=".length));
    }
    if (arg === "--reporter") {
      const nextArg = args[index + 1];
      if (!nextArg) {
        throw new Error("Missing reporter value after --reporter");
      }
      return validateReporter(nextArg);
    }
  }

  return "pretty";
}

export function buildDenoTestArgs(extraArgs: string[], reporter: string): string[] {
  return ["test", "--allow-all", "--reporter", reporter, ...extraArgs];
}

export function stripReporterArgs(args: string[]): string[] {
  const filteredArgs: string[] = [];

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg.startsWith("--reporter=")) {
      continue;
    }
    if (arg === "--reporter") {
      index++;
      continue;
    }
    filteredArgs.push(arg);
  }

  return filteredArgs;
}

export function createDotReporterState(wrapWidth = DEFAULT_DOT_WRAP_WIDTH): IDotReporterState {
  return {
    pendingDots: "",
    partialLine: "",
    wrapWidth,
  };
}

// TAP reporter support

interface ITapFailure {
  name: string;
  message: string;
}

/** TAP has no "ignored" marker, so `ignored` is always 0 for this format. */
export function parseTapOutput(output: string, durationSec: number): TestCounts {
  const clean = stripAnsi(output);
  const lines = clean.split("\n");
  let passed = 0;
  let failed = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("ok ") && !trimmed.startsWith("ok #")) {
      passed++;
    } else if (trimmed.startsWith("not ok ")) {
      failed++;
    }
  }

  return { passed, failed, ignored: 0, durationSec };
}

/** Parses the TAP failure YAML fence (`not ok N - name` / `---` / `{"message":...}` / `...`), extracting only the message field. */
export function extractTapFailures(output: string): ITapFailure[] {
  const clean = stripAnsi(output);
  const lines = clean.split("\n");
  const failures: ITapFailure[] = [];

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith("not ok ")) {
      const name = trimmed.replace(/^not ok \d+ - /, "").trim();
      let message = "";
      // Next line(s) may be a YAML block with {"message":"..."}
      if (i + 1 < lines.length && lines[i + 1].trim() === "---") {
        for (let j = i + 2; j < lines.length; j++) {
          const yamlLine = lines[j].trim();
          if (
            yamlLine === "..." || yamlLine.startsWith("ok ") || yamlLine.startsWith("not ok ") ||
            yamlLine.startsWith("1..")
          ) {
            break;
          }
          // Try to parse JSON from YAML block
          try {
            const parsed = JSON.parse(yamlLine);
            if (parsed.message) {
              // Strip ANSI from error message
              message = stripAnsi(parsed.message);
            }
          } catch {
            // Not JSON, skip
          }
        }
      }
      failures.push({ name, message: message || "(no details)" });
    }
  }

  return failures;
}

function takeWrappedSymbolLines(state: IDotReporterState, newlineToken: string): string {
  let output = "";

  while (state.pendingDots.length >= state.wrapWidth) {
    output += `${state.pendingDots.slice(0, state.wrapWidth)}${newlineToken}`;
    state.pendingDots = state.pendingDots.slice(state.wrapWidth);
  }

  return output;
}

export function compactDotReporterChunk(text: string, state: IDotReporterState): string {
  const combined = `${state.partialLine}${text}`;
  const newlineMatch = combined.match(/\r?\n/g);
  const newlineToken = newlineMatch?.[0] ?? "\n";
  const completeLines = combined.split(/\r?\n/);

  state.partialLine = combined.match(/\r?\n$/) ? "" : completeLines.pop() ?? "";
  if (state.partialLine === "" && completeLines.at(-1) === "") {
    completeLines.pop();
  }

  let output = "";
  for (const line of completeLines) {
    const visibleLine = stripAnsi(line);
    if (DOT_REPORTER_SYMBOLS_PATTERN.test(visibleLine)) {
      state.pendingDots += visibleLine;
      output += takeWrappedSymbolLines(state, newlineToken);
      continue;
    }

    if (state.pendingDots.length > 0) {
      output += state.pendingDots;
      state.pendingDots = "";
    }

    output += `${line}${newlineToken}`;
  }

  return output;
}

export function flushDotReporterState(state: IDotReporterState): string {
  let output = "";

  const visiblePartialLine = stripAnsi(state.partialLine);

  if (DOT_REPORTER_SYMBOLS_PATTERN.test(visiblePartialLine)) {
    state.pendingDots += visiblePartialLine;
    output += takeWrappedSymbolLines(state, "\n");
    state.partialLine = "";
  } else if (state.partialLine.length > 0) {
    if (state.pendingDots.length > 0) {
      output += state.pendingDots;
      state.pendingDots = "";
    }
    output += state.partialLine;
    state.partialLine = "";
  }

  if (state.pendingDots.length > 0) {
    output += `${state.pendingDots}\n`;
    state.pendingDots = "";
  }

  return output;
}

/** Maps TAP lines to compact symbols: "ok" → ".", "not ok" → "!", "ok ... # SKIP" → ","; everything else (YAML/version/plan lines) is suppressed. */
export function compactTapReporterChunk(text: string, state: IDotReporterState): string {
  const lines = text.split(/\r?\n/);
  let output = "";

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("not ok ")) {
      state.pendingDots += "!";
    } else if (trimmed.startsWith("ok ") && trimmed.includes("#")) {
      state.pendingDots += ",";
    } else if (trimmed.startsWith("ok ") && !trimmed.startsWith("ok ---")) {
      state.pendingDots += ".";
    }
  }

  output += takeWrappedSymbolLines(state, "\n");
  return output;
}

function validateReporter(value: string): TestReporter {
  if (value === "pretty" || value === "dot") {
    return value;
  }

  throw new Error(
    `Unsupported reporter \"${value}\". Expected one of: ${SUPPORTED_REPORTERS.join(", ")}`,
  );
}

/** Strip ANSI escape codes so the regex can match plain text. */
function stripAnsi(s: string): string {
  // deno-lint-ignore no-control-regex
  return s.replace(/\u001b\[[0-9;]*m/g, "");
}

function getTerminalWidth(_dest: typeof Deno.stdout): number {
  try {
    return Math.max(Deno.consoleSize().columns, 1);
  } catch {
    return DEFAULT_DOT_WRAP_WIDTH;
  }
}

// Parses the Deno test runner summary line; ignored/step counts are optional, e.g.:
//   ok | 4213 passed (981 steps) | 0 failed | 57 ignored (59s)
//   ok |    8 passed              | 0 failed            (3s)
export function parseSummaryLine(output: string): TestCounts {
  const clean = stripAnsi(output);
  const msMatch = clean.match(SUMMARY_LINE_MS_PATTERN);
  if (msMatch) {
    const [, passed, failed, ignored] = msMatch;
    return {
      passed: parseInt(passed),
      failed: parseInt(failed),
      ignored: ignored !== undefined ? parseInt(ignored) : 0,
      durationSec: 0, // sub-second, rounds to 0
    };
  }

  const secMatch = clean.match(SUMMARY_LINE_SEC_PATTERN);
  if (!secMatch) return { passed: 0, failed: 0, ignored: 0, durationSec: 0 };

  const [, passed, failed, ignored, secOrMin, trailingSec] = secMatch;

  const minutes = trailingSec !== undefined ? parseInt(secOrMin ?? "0") : 0;
  const secs = trailingSec !== undefined ? parseInt(trailingSec) : parseInt(secOrMin ?? "0");
  return {
    passed: parseInt(passed),
    failed: parseInt(failed),
    ignored: ignored !== undefined ? parseInt(ignored) : 0,
    durationSec: minutes * 60 + secs,
  };
}

function parseDotReporterCounts(output: string, durationSec: number): TestCounts {
  const clean = stripAnsi(output);
  let passed = 0;
  let failed = 0;
  let ignored = 0;

  for (const line of clean.split(/\r?\n/)) {
    if (!DOT_REPORTER_SYMBOLS_PATTERN.test(line)) {
      continue;
    }
    for (const symbol of line) {
      if (symbol === ".") passed++;
      else if (symbol === "!") failed++;
      else if (symbol === ",") ignored++;
    }
  }

  return { passed, failed, ignored, durationSec };
}

/** Invokes `deno test` directly (not via `deno task`) so piped-stdout capture isn't obscured by the task shell wrapper. */
async function runAndCapture(
  extraArgs: string[],
  label: string,
  env: Record<string, string>,
  reporter: string,
  compactHeader = false,
): Promise<TestStats> {
  const header = formatRunHeader(label, compactHeader);
  if (header.length > 0) {
    console.log(header);
  }

  const startedAt = Date.now();

  const command = new Deno.Command(Deno.execPath(), {
    args: buildDenoTestArgs(extraArgs, reporter),
    stdout: "piped",
    stderr: "piped",
    cwd: REPO_ROOT,
    env,
    // New process group (Linux setsid-equivalent) so killActiveChildGroups's
    // Deno.kill(-pid, ...) reaches every subprocess this child spawns, not just itself.
    detached: true,
  });

  const child = command.spawn();
  activeChildPids.add(child.pid);
  const outChunks: Uint8Array[] = [];
  const errChunks: Uint8Array[] = [];

  // Tee: forward each chunk to the terminal immediately AND accumulate it.
  const drain = (
    src: ReadableStream<Uint8Array>,
    store: Uint8Array[],
    dest: typeof Deno.stdout,
  ) => {
    const dotReporterState = reporter === "dot" ? createDotReporterState(getTerminalWidth(dest)) : undefined;
    const tapState = reporter === "tap" ? createDotReporterState(getTerminalWidth(dest)) : undefined;

    return (
      src
        .pipeTo(
          new WritableStream({
            write(chunk) {
              store.push(chunk);
              try {
                if (dotReporterState) {
                  const formatted = compactDotReporterChunk(new TextDecoder().decode(chunk), dotReporterState);
                  if (formatted.length > 0) {
                    dest.writeSync(new TextEncoder().encode(formatted));
                  }
                } else if (tapState) {
                  const text = new TextDecoder().decode(chunk);
                  const formatted = compactTapReporterChunk(text, tapState);
                  if (formatted.length > 0) {
                    dest.writeSync(new TextEncoder().encode(formatted));
                  }
                } else {
                  dest.writeSync(chunk);
                }
              } catch {
                // terminal fd gone (e.g. piped to grep) — ignore
              }
            },
          }),
        )
        .then(() => {
          if (dotReporterState) {
            const flushed = flushDotReporterState(dotReporterState);
            if (flushed.length > 0) {
              try {
                dest.writeSync(new TextEncoder().encode(flushed));
              } catch {
                // terminal fd gone — ignore
              }
            }
          }
          if (tapState) {
            const flushed = flushDotReporterState(tapState);
            if (flushed.length > 0) {
              try {
                dest.writeSync(new TextEncoder().encode(flushed));
              } catch {
                // terminal fd gone — ignore
              }
            }
          }
        })
        .catch(() => {})
    ); // stream errors on early process exit are benign
  };

  const [status] = await Promise.all([
    child.status,
    drain(child.stdout, outChunks, Deno.stdout),
    drain(child.stderr, errChunks, Deno.stderr),
  ]);
  activeChildPids.delete(child.pid);

  // Combine stdout + stderr to maximise chance of finding the summary line.
  const allText = new TextDecoder().decode(
    new Uint8Array([...outChunks, ...errChunks].flatMap((c) => [...c])),
  );

  const parsedSummary = parseSummaryLine(allText);
  const durationSec = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  let counts: TestCounts;
  let failures: ITapFailure[] = [];

  if ((reporter as string) === "tap") {
    // Parse TAP output for test counts and failure details.
    const tapResult = parseTapOutput(allText, durationSec);
    counts = tapResult;
    failures = extractTapFailures(allText);
    if (failures.length > 0) {
      const batchTag = label.startsWith("Batch 1") ? "PARALLEL BATCH" : "SEQUENTIAL BATCH";
      let msg = `\n${"═".repeat(60)}\n ${batchTag}: FAILURES (${counts.failed} total)\n${"═".repeat(60)}`;
      for (const f of failures) {
        msg += `\n  ${f.name}\n  ${f.message}`;
      }
      msg += `\n${"═".repeat(60)}\n`;
      allFailures.push(msg);
    }
  } else {
    counts = reporter === "dot" && parsedSummary.passed === 0 && parsedSummary.failed === 0
      ? parseDotReporterCounts(allText, durationSec)
      : parsedSummary;

    // If there were test failures, collect error details for final display.
    if (counts.failed > 0) {
      const clean = stripAnsi(allText);
      const errorsMatch = clean.match(/\n\s*ERRORS\s*\n([\s\S]*?)(?:\n\s*FAILURES\s|\n\s*═|$)/);
      if (errorsMatch) {
        const body = errorsMatch[1].trim();
        if (body) {
          const batchTag = label.startsWith("Batch 1") ? "PARALLEL BATCH" : "SEQUENTIAL BATCH";
          allFailures.push(
            `\n${"═".repeat(60)}\n ${batchTag}: FAILURES (${counts.failed} total)\n${"═".repeat(60)}\n${body}\n${
              "═".repeat(60)
            }\n`,
          );
        }
      } else if (reporter === "dot") {
        allFailures.push(`(${counts.failed} test(s) failed in "${label}". Use dot legend '!' for location.)\n`);
      }
    }
  }

  const effectiveExitCode = (reporter as string) === "tap" ? (counts.failed > 0 ? 1 : 0) : status.code;
  return { label, exitCode: effectiveExitCode, ...counts };
}

// Summary table
const LABEL_W = 50; // visible chars for the label text
const NUM_W = 6; // width of each numeric column
const TIME_W = 7; // width of the time column
// Total row width: 2(indent) + 2(icon) + 1(sp) + LABEL_W + 3*(NUM_W+2) + TIME_W+2
const WIDTH = 2 + 2 + 1 + LABEL_W + 3 * (NUM_W + 2) + TIME_W + 2;
const HR = "─".repeat(WIDTH);
const DHR = "═".repeat(WIDTH);

function formatDur(sec: number): string {
  if (sec <= 0) return "--";
  return sec >= 60 ? `${Math.floor(sec / 60)}m${String(sec % 60).padStart(2, "0")}s` : `${sec}s`;
}

// Shared accumulator for failure messages displayed at the end.
const allFailures: string[] = [];

function row(
  label: string,
  stats: TestRowData,
): string {
  const icon = stats.exitCode === 0 ? "✅" : "❌";
  const l = label.length > LABEL_W ? label.slice(0, LABEL_W - 1) + "…" : label.padEnd(LABEL_W);
  const p = String(stats.passed).padStart(NUM_W);
  const f = String(stats.failed).padStart(NUM_W);
  const i = String(stats.ignored).padStart(NUM_W);
  const t = formatDur(stats.durationSec).padStart(TIME_W);
  return `${icon} ${l}  ${p}  ${f}  ${i}  ${t}`;
}

export function formatRunHeader(label: string, compact = false): string {
  const compactLabel = label.replace(/^Batch \d+ – /, "");
  return `${compact ? "\n" : ""}› ${compactLabel}`;
}

const HEADER_LABEL = "BATCH / FILE".padEnd(LABEL_W);
const HEADER_NUMS = `${"PASS".padStart(NUM_W)}  ${"FAIL".padStart(NUM_W)}  ${"SKIP".padStart(NUM_W)}  ${
  "TIME".padStart(TIME_W)
}`;

export async function main(args: string[]): Promise<number> {
  const reporter = resolveReporter(args);
  const forwardedArgs = stripReporterArgs(args);

  if (reporter === "dot") {
    console.log(DOT_REPORTER_LEGEND);
  }

  // Edition filtering: exclude Team-only paths when EXAIX_EDITION is solo/unset
  const edition = Deno.env.get("EXAIX_EDITION") ?? "solo";
  const teamPaths = edition === "solo" ? [] : ["packages-team/"];

  // Batch 1: full test suite in parallel (use TAP reporter for error capture)
  const batch1Env: Record<string, string> = {
    ...Deno.env.toObject(),
    DENO_JOBS: BATCH1_WORKER_COUNT,
    EXA_TEST_FORCE_CLI_PARALLEL: "1",
  };
  const batch1IgnorePaths = [...SEQUENTIAL_FILES, ...PARALLEL_IGNORE_PATHS];
  const batch1IgnoreArgs = batch1IgnorePaths.map((p) => `--ignore=${p}`);

  const batch1Args = ["--parallel", "tests/", "packages/", ...teamPaths, "apps/", ...forwardedArgs];
  batch1Args.splice(1, 0, ...batch1IgnoreArgs);

  const batch1Stats = await runAndCapture(
    batch1Args,
    "Batch 1 – Parallel suite",
    batch1Env,
    "tap",
  );

  // Batch 2: sequential files, one per Deno.Command, no DENO_JOBS set.
  // Kill any daemon left behind by the parallel batch — it occupies the default
  // CLI port and causes sequential daemon tests to fail with "Daemon died during startup".
  try {
    const cleanup = new Deno.Command("pkill", { args: ["-f", "daemon/main.ts"] }).outputSync();
    if (cleanup.code === 0) {
      await new Promise((r) => setTimeout(r, 500));
    }
  } catch { /* pkill not available */ }
  // Pre-warm the daemon module cache: parallel compilation from the earlier batch
  // can leave partial/corrupted cache entries, so force a clean build before any
  // daemon subprocess touches it.
  if (SEQUENTIAL_FILES.some((f) => f.includes("daemon") || f.includes("dogfood"))) {
    const warmup = new Deno.Command("deno", { args: ["cache", "apps/daemon/main.ts"] }).spawn();
    await warmup.status;
  }
  const batch2Env: Record<string, string> = { ...Deno.env.toObject() };
  delete batch2Env["DENO_JOBS"]; // ensures skipInParallel === false inside each file

  const seq: TestStats[] = [];
  for (const file of SEQUENTIAL_FILES) {
    const stats = await runAndCapture(
      [file, ...forwardedArgs],
      `Batch 2 – ${basename(file)}`,
      batch2Env,
      reporter,
      true,
    );
    seq.push(stats);
  }

  const b2Passed = seq.reduce((a, s) => a + s.passed, 0);
  const b2Failed = seq.reduce((a, s) => a + s.failed, 0);
  const b2Ignored = seq.reduce((a, s) => a + s.ignored, 0);
  const b2Sec = seq.reduce((a, s) => a + s.durationSec, 0);
  const b2ExitCode = seq.some((s) => s.exitCode !== 0) ? 1 : 0;

  const totalPassed = batch1Stats.passed + b2Passed;
  const totalFailed = batch1Stats.failed + b2Failed;
  const totalIgnored = batch1Stats.ignored + b2Ignored;
  const totalSec = batch1Stats.durationSec + b2Sec;
  const anyFailed = batch1Stats.exitCode !== 0 || b2ExitCode !== 0;

  console.log(`\n${DHR}`);
  console.log(" TEST RUN SUMMARY");
  console.log(DHR);
  console.log(`   ${HEADER_LABEL}    ${HEADER_NUMS}`);
  console.log(HR);

  // Batch 1 row
  console.log(`  ${row("Batch 1 – Parallel suite", batch1Stats)}`);
  console.log(HR);

  // Batch 2 per-file rows
  for (const s of seq) {
    const shortLabel = s.label.replace(/^Batch 2 – /, "");
    console.log(`  ${row(shortLabel, s)}`);
  }
  console.log(HR);

  // Batch 2 subtotal
  console.log(
    `  ${
      row("Batch 2 total", {
        passed: b2Passed,
        failed: b2Failed,
        ignored: b2Ignored,
        durationSec: b2Sec,
        exitCode: b2ExitCode,
      })
    }`,
  );
  console.log(DHR);

  // Grand total
  console.log(
    `  ${
      row("GRAND TOTAL", {
        passed: totalPassed,
        failed: totalFailed,
        ignored: totalIgnored,
        durationSec: totalSec,
        exitCode: anyFailed ? 1 : 0,
      })
    }`,
  );
  console.log(`${DHR}\n`);

  if (anyFailed) {
    console.error("❌  One or more batches failed.\n");
  } else {
    console.log("🎉  All batches passed.\n");
  }

  if (allFailures.length > 0) {
    for (const msg of allFailures) {
      console.error(msg);
    }
  }

  return anyFailed ? 1 : 0;
}

if (import.meta.main) {
  // On an external interrupt (Ctrl-C, or a harness/CI timeout sending SIGTERM), kill every
  // tracked child's process group before exiting — see activeChildPids's doc comment for why
  // this is required (a plain process exit does not cascade to a child's own children).
  const onSignal = () => {
    killActiveChildGroups();
    Deno.exit(1);
  };
  Deno.addSignalListener("SIGINT", onSignal);
  Deno.addSignalListener("SIGTERM", onSignal);

  let exitCode = 1;
  try {
    exitCode = await main(Deno.args);
  } finally {
    // Defensive: a thrown error (not a signal) also leaves no further code running to reach
    // runAndCapture's own post-await cleanup — clear any still-tracked group just in case.
    killActiveChildGroups();
  }
  Deno.exit(exitCode);
}
