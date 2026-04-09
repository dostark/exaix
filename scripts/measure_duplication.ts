/**
 * @module measure_duplication
 * @description Script: measure_duplication
 */
import { parse } from "@std/flags";
import { join } from "@std/path";

/**
 * Script to measure code duplication using jscpd
 *
 * Usage:
 * deno run --allow-run --allow-read --allow-write scripts/measure_duplication.ts [--threshold <num>]
 */

const flags = parse(Deno.args, {
  string: ["threshold"],
  default: { threshold: "2" },
});

const THRESHOLD = parseFloat(flags.threshold);

async function runDuplicationCheck() {
  console.log(`🔍 Running duplication check with threshold ${THRESHOLD}%...`);

  const cmd = new Deno.Command("npx", {
    args: [
      "jscpd",
      "src/",
      "tests/",
      "--ignore",
      "**/*.d.ts",
      "--min-lines",
      "5",
      "--min-tokens",
      "50",
      "--threshold",
      String(THRESHOLD),
      "--reporters",
      "console,json",
      "--output",
      ".duplication_report",
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

  // Parse JSON report to get exact numbers
  try {
    const reportPath = join(".duplication_report", "jscpd-report.json");
    const reportText = await Deno.readTextFile(reportPath);
    const report = JSON.parse(reportText);

    const totalPercentage = report.statistics.total.percentage;

    console.log("----------------------------------------");
    console.log(`📉 Duplication Level: ${totalPercentage}%`);
    console.log(`🎯 Threshold: ${THRESHOLD}%`);

    if (totalPercentage > THRESHOLD) {
      console.error(`❌ Duplication threshold exceeded! (${totalPercentage}% > ${THRESHOLD}%)`);
      Deno.exit(1);
    } else {
      console.log(`✅ Duplication check passed!`);
    }
  } catch (_err) {
    if (code !== 0) {
      console.error("❌ jscpd failed execution");
      console.error(errorOutput);
      Deno.exit(1);
    }
    console.log("⚠️ Could not parse detailed report, but basic check passed.");
  }
}

if (import.meta.main) {
  await runDuplicationCheck();
}
