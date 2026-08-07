/**
 * @module ScenarioFrameworkModesContinueOnFailureTest
 * @path tests/scenario_framework/tests/unit/modes_continue_on_failure_test.ts
 * @description Proves that a step declaring `continue_on_failure: true` does NOT halt the
 *   scenario loop: its failure is recorded but later steps (e.g. an llm-judge with a
 *   test_run_source) still execute, so a failing test run is graded rather than skipped.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/modes.ts]
 */

import { assertEquals } from "@std/assert";
import { ExecutionStateStatus, type IExecuteStepCallbackArgs, runScenarioInMode } from "../../runner/modes.ts";
import { type IScenarioStep, ScenarioExecutionMode, ScenarioStepType } from "../../schema/step_schema.ts";

function step(id: string, continueOnFailure: boolean): IScenarioStep {
  return {
    id,
    type: ScenarioStepType.TEST_RUN,
    command: "deno",
    args: ["test"],
    continue_on_failure: continueOnFailure,
    input_criteria: [],
    output_criteria: [],
  } as IScenarioStep;
}

function failedResult(stepId: string): IScenarioStepExecutionResultLike {
  return {
    stepId,
    stepType: "test-run",
    exitCode: 1,
    startedAt: "",
    completedAt: "",
    durationMs: 0,
    stdout: "FAILED",
    stderr: "",
    combinedOutput: "FAILED",
    executionFailed: true,
  };
}

type IScenarioStepExecutionResultLike = {
  stepId: string;
  stepType: string;
  exitCode: number;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  stdout: string;
  stderr: string;
  combinedOutput: string;
  executionFailed?: boolean;
};

Deno.test("[modes] continue_on_failure keeps the loop running after a failing step", async () => {
  const called: string[] = [];
  const result = await runScenarioInMode({
    scenarioId: "continue-on-failure",
    steps: [step("verify-tests", true), step("judge-quality", false)],
    mode: ScenarioExecutionMode.AUTO,
    executeStep: ({ step }: IExecuteStepCallbackArgs) => {
      called.push(step.id);
      if (step.id === "verify-tests") return failedResult(step.id) as never;
      return {
        stepId: step.id,
        stepType: "judge",
        exitCode: 0,
        startedAt: "",
        completedAt: "",
        durationMs: 0,
        stdout: "ok",
        stderr: "",
        combinedOutput: "ok",
      } as never;
    },
  });
  assertEquals(
    called,
    ["verify-tests", "judge-quality"],
    "the judge step must still execute after a failing, continue_on_failure test step",
  );
  assertEquals(result.status, ExecutionStateStatus.FAILED, "the run outcome still records the failure");
});

Deno.test("[modes] a failing step WITHOUT continue_on_failure halts the loop (judge skipped)", async () => {
  const called: string[] = [];
  const result = await runScenarioInMode({
    scenarioId: "halt-on-failure",
    steps: [step("verify-tests", false), step("judge-quality", false)],
    mode: ScenarioExecutionMode.AUTO,
    executeStep: ({ step }: IExecuteStepCallbackArgs) => {
      called.push(step.id);
      return failedResult(step.id) as never;
    },
  });
  assertEquals(called, ["verify-tests"], "without continue_on_failure the loop stops at the failure");
  assertEquals(result.status, ExecutionStateStatus.FAILED);
});
