// deno-lint-ignore-file no-explicit-any
/**
 * @module ScenarioFrameworkReporter
 * @path tests/scenario_framework/runner/reporter.ts
 * @description Provides formatted reporting of scenario failures, including
 * detailed execution results (stdout/stderr) and specific criterion failure
 * messages with observed vs expected values.
 * @architectural-layer Test
 */

import type { Opt, Reason } from "@exaix/core/types";
import { CriterionStatus } from "../schema/step_schema.ts";
import { StepFailureStage } from "./assertions.ts";
import type { IRunSyntheticScenarioResult } from "./synthetic_runner.ts";
import type { IScenarioVerdict } from "./scoring.ts";

export function reportScenarioFailure(result: IRunSyntheticScenarioResult): void {
  const failedSteps = result.stepOutcomes.filter(
    (o) => o.status === CriterionStatus.FAILED || o.status === CriterionStatus.ERROR,
  );

  if (failedSteps.length === 0) {
    return;
  }

  console.log("\n%c--- FAILURE DETAILS ---", "color: red; font-weight: bold;");

  for (const outcome of failedSteps) {
    console.log(`\n%cStep Failed: ${outcome.stepId}`, "color: yellow; font-weight: bold;");
    console.log(`Stage: ${outcome.failureStage ?? "unknown"}`);

    if (outcome.failureStage === StepFailureStage.EXECUTION && outcome.executionResult) {
      const res = outcome.executionResult;
      console.log(`Exit Code: ${res.exitCode}`);
      if (res.stderr.trim()) {
        console.log("Stderr:");
        console.log(indent(res.stderr.trim()));
      } else if (res.stdout.trim()) {
        console.log("Stdout (no stderr captured):");
        console.log(indent(res.stdout.trim()));
      }
    } else {
      const failedCriteria = outcome.criterionResults.filter(
        (c) => c.status === CriterionStatus.FAILED || c.status === CriterionStatus.ERROR,
      );

      for (const crit of failedCriteria) {
        console.log(`\nCriterion [${crit.criterion_id}] (${crit.kind})`);
        console.log(`Message: %c${crit.message}`, "color: red;");

        if (crit.observed_value !== undefined) {
          console.log(`  Observed: ${formatValue(crit.observed_value)}`);
        }
        if (crit.expected_value !== undefined) {
          console.log(`  Expected: ${formatValue(crit.expected_value)}`);
        }
      }
    }
  }

  if (result.executionLogPath) {
    console.log(`\n%cFull sequence execution log available at:\n${result.executionLogPath}`, "color: cyan;");
  }

  console.log("%c-----------------------", "color: red; font-weight: bold;");
}

export function reportSuiteSummary(
  scenarioVerdicts: IScenarioVerdict[],
  threshold?: Opt<number, Reason.OptionalInput>,
): void {
  if (scenarioVerdicts.length === 0) return;

  console.log("\n%c=== SUITE SUMMARY ===", "color: cyan; font-weight: bold;");

  const idPad = Math.max(...scenarioVerdicts.map((v) => v.scenarioId.length), 10);
  const packPad = Math.max(...scenarioVerdicts.map((v) => v.pack.length), 6);
  const sep = `${"-".repeat(idPad + 2)}|${"-".repeat(packPad + 2)}|${"-".repeat(10)}|${"-".repeat(10)}`;

  console.log(
    `  ${padRight("SCENARIO", idPad)}  | ${padRight("PACK", packPad)}  | ${padRight("SCORE", 8)}  | ${
      padRight("PASSED", 8)
    }`,
  );
  console.log(`  ${sep}`);

  for (const v of scenarioVerdicts) {
    const scoreStr = v.suiteScore.toFixed(3);
    const passStr = v.passed ? "✅" : "❌";
    console.log(
      `  ${padRight(v.scenarioId, idPad)}  | ${padRight(v.pack, packPad)}  | ${padRight(scoreStr, 8)}  | ${
        padRight(passStr, 8)
      }`,
    );
  }

  console.log(`  ${sep}`);

  const scores = scenarioVerdicts.map((v) => v.suiteScore);
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
  console.log(`  ${padRight("", idPad)}  | ${padRight("", packPad)}  | ${padRight("MEAN", 8)}  | ${mean.toFixed(3)}`);

  if (threshold !== undefined) {
    const passedCount = scenarioVerdicts.filter((v) => v.passed).length;
    console.log(`\n  Threshold: ${threshold.toFixed(2)}  |  Passed: ${passedCount}/${scenarioVerdicts.length}`);
  }

  console.log("%c========================\n", "color: cyan; font-weight: bold;");
}

function padRight(s: string, len: number): string {
  return s.length >= len ? s : s + " ".repeat(len - s.length);
}

function indent(text: string): string {
  return text.split("\n").map((line) => `  ${line}`).join("\n");
}

function formatValue(val: any): string {
  if (typeof val === "string") return `"${val}"`;
  return JSON.stringify(val);
}
