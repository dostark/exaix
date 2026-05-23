#!/usr/bin/env -S deno run -A
/**
 * @module TestParallel
 * @path scripts/test_parallel.ts
 * @description Two-batch test runner that maximises parallel throughput while
 * still executing CLI-subprocess-heavy tests that are unsafe to run concurrently.
 *
 * Batch 1 – the whole test suite run with DENO_JOBS=8 and --parallel for
 *            maximum speed.
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
const SUPPORTED_REPORTERS = ["pretty", "dot"] as const;
export const DOT_REPORTER_LEGEND = "dot legend: .=passed ,=ignored !=failed";

type TestReporter = typeof SUPPORTED_REPORTERS[number];

/**
 * Test files that must be executed sequentially because they spawn CLI
 * sub-processes that are sensitive to environment variable cross-contamination.
 */
const SEQUENTIAL_FILES: string[] = [
  "tests/scenario_framework/tests/plan_amendment_scenario_test.ts",
  "tests/integration/18_cli_commands_integration_test.ts",
  "tests/integration/24_portal_e2e_workflow_test.ts",
  "tests/integration/26_portal_worktree_review_cleanup_e2e_test.ts",
  "tests/services/deploy/deploy_workspace_test.ts",
  "tests/services/agent/agent_executor_test.ts",
  "apps/exactl/tests/review_commands_test.ts",
  "apps/exactl/tests/exactl_all_test.ts",
  "packages/ai/tests/providers/free_providers_test.ts",
  "packages/ai/tests/providers/openai_shim_retry_test.ts",
  "packages/ai/tests/provider_factory_test.ts",
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

export function buildDenoTestArgs(extraArgs: string[], reporter: TestReporter): string[] {
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
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

function getTerminalWidth(_dest: typeof Deno.stdout): number {
  try {
    return Math.max(Deno.consoleSize().columns, 1);
  } catch {
    return DEFAULT_DOT_WRAP_WIDTH;
  }
}

/**
 * Parse the Deno test runner summary line in two formats:
 *   ok | 4213 passed (981 steps) | 0 failed | 57 ignored (59s)
 *   ok |    8 passed              | 0 failed            (3s)
 *   ok |   50 passed              | 0 failed | 1 ignored (696ms)
 */
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

/**
 * Run `deno test --allow-all ...extraArgs` directly, tee both stdout and stderr
 * to the terminal in real time, and capture output for summary parsing.
 *
 * Note: `deno test` is invoked directly (not via `deno task`) so that the
 * piped-stdout capture is not obscured by the deno task shell wrapper.
 */
async function runAndCapture(
  extraArgs: string[],
  label: string,
  env: Record<string, string>,
  reporter: TestReporter,
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
  });

  const child = command.spawn();
  const outChunks: Uint8Array[] = [];
  const errChunks: Uint8Array[] = [];

  // Tee: forward each chunk to the terminal immediately AND accumulate it.
  const drain = (
    src: ReadableStream<Uint8Array>,
    store: Uint8Array[],
    dest: typeof Deno.stdout,
  ) => {
    const dotReporterState = reporter === "dot" ? createDotReporterState(getTerminalWidth(dest)) : undefined;

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
        })
        .catch(() => {})
    ); // stream errors on early process exit are benign
  };

  const [status] = await Promise.all([
    child.status,
    drain(child.stdout, outChunks, Deno.stdout),
    drain(child.stderr, errChunks, Deno.stderr),
  ]);

  // Combine stdout + stderr to maximise chance of finding the summary line.
  const allText = new TextDecoder().decode(
    new Uint8Array([...outChunks, ...errChunks].flatMap((c) => [...c])),
  );

  const parsedSummary = parseSummaryLine(allText);
  const durationSec = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  const counts = reporter === "dot" && parsedSummary.passed === 0 && parsedSummary.failed === 0
    ? parseDotReporterCounts(allText, durationSec)
    : parsedSummary;

  return { label, exitCode: status.code, ...counts };
}

// ---------------------------------------------------------------------------
// Summary table
// ---------------------------------------------------------------------------
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

  // ---------------------------------------------------------------------------
  // Batch 1: full test suite in parallel
  // ---------------------------------------------------------------------------
  const batch1Env: Record<string, string> = { ...Deno.env.toObject(), DENO_JOBS: "8" };
  const batch1IgnoreArg = `--ignore=${SEQUENTIAL_FILES.join(",")}`;

  const batch1Stats = await runAndCapture(
    ["--parallel", batch1IgnoreArg, ...forwardedArgs],
    "Batch 1 – Parallel suite",
    batch1Env,
    reporter,
  );

  // ---------------------------------------------------------------------------
  // Batch 2: sequential files, one per Deno.Command, no DENO_JOBS set
  // ---------------------------------------------------------------------------
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
    return 1;
  }

  console.log("🎉  All batches passed.\n");
  return 0;
}

if (import.meta.main) {
  Deno.exit(await main(Deno.args));
}
