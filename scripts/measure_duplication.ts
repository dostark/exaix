#!/usr/bin/env -S deno run -A
/**
 * @module MeasureDuplication
 * @path scripts/measure_duplication.ts
 * @description Scans the codebase for cloned code blocks using jscpd to help reduce redundancy.
 *
 * Usage:
 *   deno run -A scripts/measure_duplication.ts [--threshold <num>] [--tests-threshold <num>]
 */
import { parse } from "@std/flags";
import { join } from "@std/path";

const flags = parse(Deno.args, {
  string: ["threshold", "tests-threshold", "integration-tests-threshold"],
  default: { threshold: "2", "tests-threshold": "3", "integration-tests-threshold": "3" },
});

const SOURCE_THRESHOLD = parseFloat(flags.threshold);
const TEST_THRESHOLD = parseFloat(flags["tests-threshold"]);
const INTEGRATION_TEST_THRESHOLD = parseFloat(flags["integration-tests-threshold"]);

interface IDuplicationTotals {
  lines: number;
  tokens: number;
  sources: number;
  clones: number;
  duplicatedLines: number;
  duplicatedTokens: number;
  percentage: number;
  percentageTokens: number;
  newDuplicatedLines: number;
  newClones: number;
}

async function runJscpdScan(
  label: string,
  paths: string[],
  threshold: number,
  outputDir: string,
  ignorePatterns: string[] = ["**/*.d.ts"],
): Promise<IDuplicationTotals> {
  console.log(`🔍 Running ${label} duplication check with threshold ${threshold}%...`);

  const cmd = new Deno.Command("npx", {
    args: [
      "jscpd",
      ...paths,
      "--ignore",
      ignorePatterns.join(","),
      "--min-lines",
      "5",
      "--min-tokens",
      "50",
      "--threshold",
      String(threshold),
      "--reporters",
      "console,json",
      "--output",
      outputDir,
    ],
    stdout: "piped",
    stderr: "piped",
  });

  const { code, stdout, stderr } = await cmd.output();
  const output = new TextDecoder().decode(stdout);
  const errorOutput = new TextDecoder().decode(stderr);

  if (code !== 0 && !errorOutput.includes("ERROR:")) {
    // jscpd returns non-zero if threshold is exceeded
    console.log(output);
    console.error(errorOutput); // Might contain threshold error
  } else {
    console.log(output);
  }

  try {
    const reportPath = join(outputDir, "jscpd-report.json");
    const reportText = await Deno.readTextFile(reportPath);
    const report = JSON.parse(reportText);

    return report.statistics.total as IDuplicationTotals;
  } catch (_err) {
    if (code !== 0) {
      console.error(`❌ ${label} jscpd execution failed`);
      console.error(errorOutput);
      Deno.exit(1);
    }

    console.log(`⚠️ Could not parse detailed ${label} duplication report.`);
    return {
      lines: 0,
      tokens: 0,
      sources: 0,
      clones: 0,
      duplicatedLines: 0,
      duplicatedTokens: 0,
      percentage: 0,
      percentageTokens: 0,
      newDuplicatedLines: 0,
      newClones: 0,
    };
  }
}

function logTotals(label: string, totals: IDuplicationTotals, threshold: number): boolean {
  console.log("----------------------------------------");
  console.log(`📉 ${label} Duplication Level: ${totals.percentage}%`);
  console.log(`🎯 ${label} Threshold: ${threshold}%`);

  if (totals.percentage > threshold) {
    console.error(`❌ ${label} duplication threshold exceeded! (${totals.percentage}% > ${threshold}%)`);
    return false;
  }

  console.log(`✅ ${label} duplication check passed!`);
  return true;
}

async function runDuplicationCheck() {
  const sourceTotals = await runJscpdScan(
    "Source",
    ["packages/", "apps/"],
    SOURCE_THRESHOLD,
    ".duplication_report_src",
    ["**/*.d.ts", "**/*.md", "**/tests/**"],
  );
  const testsTotals = await runJscpdScan(
    "Tests",
    ["tests/"],
    TEST_THRESHOLD,
    ".duplication_report_tests",
    ["**/*.d.ts", "**/*.md", "tests/integration/**", "tests/scenario_framework/**"],
  );
  const integrationTestsTotals = await runJscpdScan(
    "Integration Tests",
    ["tests/integration", "tests/scenario_framework"],
    INTEGRATION_TEST_THRESHOLD,
    ".duplication_report_integration_tests",
    ["**/*.d.ts", "**/*.md", "**/*.yaml", "**/*.yml"],
  );

  const sourcePassed = logTotals("Source", sourceTotals, SOURCE_THRESHOLD);
  const testsPassed = logTotals("Tests", testsTotals, TEST_THRESHOLD);
  const integrationTestsPassed = logTotals(
    "Integration Tests",
    integrationTestsTotals,
    INTEGRATION_TEST_THRESHOLD,
  );

  console.log("----------------------------------------");
  console.log(
    `📦 Combined Duplication Snapshot: ${
      sourceTotals.duplicatedLines + testsTotals.duplicatedLines + integrationTestsTotals.duplicatedLines
    } duplicated lines across packages/, apps/, tests/, and integration/scenario tests`,
  );

  if (!sourcePassed || !testsPassed || !integrationTestsPassed) {
    Deno.exit(1);
  }
}

if (import.meta.main) {
  await runDuplicationCheck();
}
