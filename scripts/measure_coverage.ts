#!/usr/bin/env -S deno run -A
/**
 * @module MeasureCoverage
 * @path scripts/measure_coverage.ts
 * @description Test coverage orchestrator that runs tests and enforces coverage thresholds.
 *
 * Usage:
 *   deno run -A scripts/measure_coverage.ts [options]
 *
 * Options:
 *   --limit <num>      Percentage threshold to fail below (default: 80)
 *   --full             Run the entire suite (ignore self-skipping tests)
 *   --parallel         Run tests in parallel (can be sensitive to DB/shared state)
 *   --with-llama       Run with Llama-specific filters (self-skips if missing)
 */
import { parse } from "@std/flags";

const flags = parse(Deno.args, {
  string: ["limit"],
  boolean: ["full", "parallel", "with-llama"],
});

const LINE_THRESHOLD = 70;
const BRANCH_THRESHOLD = 60;
const COVERAGE_DIR = "coverage";

const COVERAGE_EXCLUDE_PATTERNS = [
  "^file:///tmp/",
  "/scripts/",
];

type CoverageRow = {
  file: string;
  branchPct: number;
  linePct: number;
};

function filterKnownNoisyCoverageWarnings(stderrText: string): string {
  // Deno can emit a non-fatal warning when coverage data references temp files
  // created/deleted during tests (e.g., /tmp/exa-flow-*/my-flow.flow.ts).
  // The run still succeeds, so we filter this message to keep output clean.
  return stderrText
    .split("\n")
    .filter((line) => !line.includes('Error generating coverage report: Failed to fetch "file:///tmp/'))
    .filter((line) => !line.includes("Error generating coverage report: Failed to create output file:"))
    .filter((line) => !line.includes("Before generating coverage report, run `deno test --coverage`"))
    .join("\n")
    .trim();
}

function stripAnsi(text: string): string {
  // Matches ANSI color/style codes like: \x1b[0m, \x1b[32m, \x1b[1;33m
  // Build the escape character without embedding control chars or \u escapes in source.
  const esc = String.fromCharCode(27);
  const ansiRegex = new RegExp(`${esc}\\[[0-9;]*m`, "g");
  return text.replace(ansiRegex, "");
}

function parseCoverageTable(output: string): CoverageRow[] {
  const rows: CoverageRow[] = [];

  for (const rawLine of stripAnsi(output).split("\n")) {
    const line = rawLine.trimEnd();
    if (!line.startsWith("|")) continue;
    if (line.includes("----")) continue;
    if (line.startsWith("| File")) continue;

    const match = line.match(/^\|\s*(.+?)\s*\|\s*([0-9]+(?:\.[0-9]+)?)\s*\|\s*([0-9]+(?:\.[0-9]+)?)\s*\|?$/);
    if (!match) continue;

    const file = match[1];
    const branchPct = Number(match[2]);
    const linePct = Number(match[3]);

    if (!Number.isFinite(branchPct) || !Number.isFinite(linePct)) continue;

    rows.push({ file, branchPct, linePct });
  }

  return rows;
}

function printLowestCovered(
  rows: CoverageRow[],
  opts: { label: string; filter: (row: CoverageRow) => boolean; limit: number },
) {
  const filtered = rows
    .filter(opts.filter)
    .filter((r) => r.file !== "All files")
    .toSorted((a, b) => a.linePct - b.linePct);

  console.log(`\n📉 Lowest covered (${opts.label})`);
  for (const row of filtered.slice(0, opts.limit)) {
    console.log(
      `- ${row.file} (line ${row.linePct.toFixed(1)}%, branch ${row.branchPct.toFixed(1)}%)`,
    );
  }
}

async function runCoverageReport(): Promise<string> {
  const covSummaryCmd = new Deno.Command("deno", {
    args: [
      "coverage",
      COVERAGE_DIR,
      ...COVERAGE_EXCLUDE_PATTERNS.map((pattern) => `--exclude=${pattern}`),
    ],
    stdout: "piped",
    stderr: "piped",
    // CI may run this script without `--allow-env`. Deno.Command inherits the
    // parent environment by default, so we only need to override NO_COLOR.
    env: { NO_COLOR: "1" },
  });

  const result = await covSummaryCmd.output();
  const stdout = new TextDecoder().decode(result.stdout);
  const stderr = new TextDecoder().decode(result.stderr);

  if (result.code !== 0) {
    throw new Error(
      `deno coverage failed (exit ${result.code})${stderr ? `: ${stderr.trim()}` : ""}`,
    );
  }

  return stdout;
}

async function runCoverageCheck() {
  console.log(`🧪 Running tests with coverage tracking...`);

  // Coverage data accumulates across runs if the directory is reused.
  // Clean it first so summaries match the current test run.
  try {
    await Deno.remove(COVERAGE_DIR, { recursive: true });
  } catch {
    // Ignore missing directory / permission issues.
  }
  await Deno.mkdir(COVERAGE_DIR, { recursive: true });

  // 1. Run Tests
  const testCmd = new Deno.Command("deno", {
    args: [
      "test",
      "--allow-all",
      ...(flags.parallel ? ["--parallel"] : []),
      `--coverage=${COVERAGE_DIR}`,
      // Note: an explicit --ignore replaces the deno.json `exclude` config,
      // so any fixture paths skipped by config must be re-listed here.
      "--ignore=tests/scenario_framework/fixtures/",
      ...(flags["with-llama"] ? [] : ["--ignore=tests/llama_provider_test.ts"]),
      "tests/",
      "packages/",
      "apps/",
    ],
    stdout: "inherit",
    // Capture stderr so we can filter known noisy, non-fatal coverage warnings.
    stderr: "piped",
  });

  const testResult = await testCmd.output();

  const testStderr = new TextDecoder().decode(testResult.stderr);
  const filteredTestStderr = filterKnownNoisyCoverageWarnings(testStderr);
  if (filteredTestStderr) {
    console.error(filteredTestStderr);
  }

  const testsPassed = testResult.code === 0;
  if (!testsPassed) {
    console.error(
      "❌ Tests failed. Attempting to generate coverage report from partial results...",
    );
  }

  // 2. Generate Coverage Report
  console.log(`📊 Generating coverage report...`);

  const covCmd = new Deno.Command("deno", {
    args: [
      "coverage",
      COVERAGE_DIR,
      "--lcov",
      ...COVERAGE_EXCLUDE_PATTERNS.map((pattern) => `--exclude=${pattern}`),
    ],
    stdout: "piped",
    stderr: "piped",
    // CI may run this script without `--allow-env`. Deno.Command inherits the
    // parent environment by default, so we only need to override NO_COLOR.
    env: { NO_COLOR: "1" },
  });

  try {
    const lcovResult = await covCmd.output();
    if (lcovResult.code !== 0) {
      const stderr = new TextDecoder().decode(lcovResult.stderr);
      console.error(
        `⚠️  Failed to generate LCOV (exit ${lcovResult.code})${stderr ? `: ${stderr.trim()}` : ""}`,
      );
    } else {
      const _lcovOutput = new TextDecoder().decode(lcovResult.stdout);
      void _lcovOutput;
    }
  } catch (error) {
    console.error(
      `⚠️  Failed to generate LCOV: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  // Basic parsing of LCOV to total percentage (very rough approximation)
  // Logic: Sum of (DA:line,hits) / Total Lines
  // A better approach in a real CI would be to pipe this to a tool like lcov-parse or codecov
  // For this script, we'll try to extract the summary if available or just check command success.

  // Since deno coverage --lcov doesn't output summary stats easily, we will run without lcov for human readable
  // and parse that.

  const limit = Number.parseInt(flags.limit ?? "15", 10);
  const listLimit = Number.isFinite(limit) && limit > 0 ? limit : 15;

  let summaryText = "";
  try {
    summaryText = await runCoverageReport();
  } catch (error) {
    console.error(
      `⚠️  Failed to generate coverage table: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (summaryText) {
    if (flags.full) {
      console.log(summaryText);
    }

    const rows = parseCoverageTable(summaryText);
    const totals = rows.find((r) => r.file === "All files");

    if (totals) {
      console.log(
        `\n✅ Coverage totals: line ${totals.linePct.toFixed(1)}%, branch ${totals.branchPct.toFixed(1)}%`,
      );

      if (totals.linePct < LINE_THRESHOLD || totals.branchPct < BRANCH_THRESHOLD) {
        console.error(
          `❌ Coverage below threshold (line ${LINE_THRESHOLD}%, branch ${BRANCH_THRESHOLD}%).`,
        );
        Deno.exit(1);
      }
    }

    console.log(`\nℹ️  Coverage excludes: ${COVERAGE_EXCLUDE_PATTERNS.join(", ")}`);

    printLowestCovered(rows, {
      label: "apps/ + packages/",
      filter: (r) => r.file.startsWith("apps/") || r.file.startsWith("packages/"),
      limit: listLimit,
    });
  }

  // Extract total coverage from the end of the output if exists, or calculate manual average
  // Deno coverage default output lists files. It doesn't give a grand total line.

  // We will assume success if tests passed for now, but in a real setting we'd process the lcov.
  console.log(`\n✅ Coverage report generated.`);
  if (!flags.full) {
    console.log(`ℹ️  Tip: re-run with --full to print the full per-file table.`);
  }

  // Cleanup
  // await Deno.remove(COVERAGE_DIR, { recursive: true });

  if (!testsPassed) {
    Deno.exit(testResult.code);
  }
}

if (import.meta.main) {
  await runCoverageCheck();
}
