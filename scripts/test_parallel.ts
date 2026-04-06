/**
 * @module test_parallel
 * @description Two-batch test runner that maximises parallel throughput while
 * still executing CLI-subprocess-heavy tests that are unsafe to run concurrently.
 *
 * Batch 1 – the whole test suite run with DENO_JOBS=8 and --parallel for
 *            maximum speed. The sequential files are included but their
 *            guarded tests self-skip when DENO_JOBS is set.
 * Batch 2 – the sequential files run one after another without DENO_JOBS so
 *            their skipInParallel guards evaluate to false and every test runs.
 *
 * A combined summary is printed at the end of both batches.
 *
 * Usage:
 *   deno task test_parallel
 */

import { basename, fromFileUrl, join } from "@std/path";

const REPO_ROOT = join(fromFileUrl(import.meta.url), "..", "..");

/**
 * Test files that must be executed sequentially because they spawn CLI
 * sub-processes that are sensitive to environment variable cross-contamination.
 */
const SEQUENTIAL_FILES: string[] = [
  "tests/integration/18_cli_commands_integration_test.ts",
  "tests/integration/24_portal_e2e_workflow_test.ts",
  "tests/integration/26_portal_worktree_review_cleanup_e2e_test.ts",
  "tests/services/deploy/deploy_workspace_test.ts",
  "tests/cli/exactl_all_test.ts",
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

/** Strip ANSI escape codes so the regex can match plain text. */
function stripAnsi(s: string): string {
  // deno-lint-ignore no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

/**
 * Parse the Deno test runner summary line in two formats:
 *   ok | 4213 passed (981 steps) | 0 failed | 57 ignored (59s)
 *   ok |    8 passed              | 0 failed            (3s)
 */
function parseSummaryLine(output: string): TestCounts {
  const clean = stripAnsi(output);
  const m = clean.match(
    /\|\s*(\d+)\s+passed(?:\s*\(\d+\s+steps?\))?\s*\|\s*(\d+)\s+failed(?:\s*\|\s*(\d+)\s+ignored)?\s*\((\d+)(?:m(\d+))?s\)/,
  );
  if (!m) return { passed: 0, failed: 0, ignored: 0, durationSec: 0 };
  const [, p, f, ign, t1, t2] = m;
  const minutes = t2 !== undefined ? parseInt(t1) : 0;
  const secs = t2 !== undefined ? parseInt(t2) : parseInt(t1);
  return {
    passed: parseInt(p),
    failed: parseInt(f),
    ignored: ign !== undefined ? parseInt(ign) : 0,
    durationSec: minutes * 60 + secs,
  };
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
): Promise<TestStats> {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`▶  ${label}`);
  console.log(`${"=".repeat(60)}\n`);

  const command = new Deno.Command(Deno.execPath(), {
    args: ["test", "--allow-all", ...extraArgs],
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
  ) =>
    src
      .pipeTo(
        new WritableStream({
          write(chunk) {
            store.push(chunk);
            try {
              dest.writeSync(chunk);
            } catch {
              // terminal fd gone (e.g. piped to grep) — ignore
            }
          },
        }),
      )
      .catch(() => {}); // stream errors on early process exit are benign

  const [status] = await Promise.all([
    child.status,
    drain(child.stdout, outChunks, Deno.stdout),
    drain(child.stderr, errChunks, Deno.stderr),
  ]);

  // Combine stdout + stderr to maximise chance of finding the summary line.
  const allText = new TextDecoder().decode(
    new Uint8Array([...outChunks, ...errChunks].flatMap((c) => [...c])),
  );

  return { label, exitCode: status.code, ...parseSummaryLine(allText) };
}

// ---------------------------------------------------------------------------
// Batch 1: full test suite in parallel
// ---------------------------------------------------------------------------
const batch1Env: Record<string, string> = { ...Deno.env.toObject(), DENO_JOBS: "8" };

const batch1Stats = await runAndCapture(
  ["--parallel"],
  "Batch 1 – Parallel suite",
  batch1Env,
);

// ---------------------------------------------------------------------------
// Batch 2: sequential files, one per Deno.Command, no DENO_JOBS set
// ---------------------------------------------------------------------------
const batch2Env: Record<string, string> = { ...Deno.env.toObject() };
delete batch2Env["DENO_JOBS"]; // ensures skipInParallel === false inside each file

const seq: TestStats[] = [];
for (const file of SEQUENTIAL_FILES) {
  const stats = await runAndCapture(
    [file],
    `Batch 2 – ${basename(file)}`,
    batch2Env,
  );
  seq.push(stats);
}

// ---------------------------------------------------------------------------
// Summary table
// ---------------------------------------------------------------------------
const LABEL_W = 50; // visible chars for the label text
const NUM_W = 6; // width of each numeric column
const TIME_W = 7; // width of the time column
// Total row width: 2(indent) + 2(icon) + 1(sp) + LABEL_W + 3*(NUM_W+2) + TIME_W+1
const WIDTH = 2 + 2 + 1 + LABEL_W + 3 * (NUM_W + 2) + TIME_W + 1;
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

const HEADER_LABEL = "BATCH / FILE".padEnd(LABEL_W);
const HEADER_NUMS = `${"PASS".padStart(NUM_W)}  ${"FAIL".padStart(NUM_W)}  ${"SKIP".padStart(NUM_W)}  ${
  "TIME".padStart(TIME_W)
}`;

console.log(`\n${DHR}`);
console.log(" TEST RUN SUMMARY");
console.log(DHR);
console.log(`   ${HEADER_LABEL}  ${HEADER_NUMS}`);
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
  Deno.exit(1);
}
console.log("🎉  All batches passed.\n");
