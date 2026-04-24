// deno-lint-ignore-file no-explicit-any
/**
 * @module ScenarioFrameworkReporter
 * @path tests/scenario_framework/runner/reporter.ts
 * @description Provides formatted reporting of scenario failures, including
 * detailed execution results (stdout/stderr) and specific criterion failure
 * messages with observed vs expected values.
 * @architectural-layer Test
 */

import { CriterionStatus } from "../schema/step_schema.ts";
import { StepFailureStage } from "./assertions.ts";
import type { IRunSyntheticScenarioResult } from "./synthetic_runner.ts";

/**
 * Prints detailed failure information for a failed scenario to the console.
 * @param result The full result of the synthetic scenario run.
 */
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

function indent(text: string): string {
  return text.split("\n").map((line) => `  ${line}`).join("\n");
}

function formatValue(val: any): string {
  if (typeof val === "string") return `"${val}"`;
  return JSON.stringify(val);
}
