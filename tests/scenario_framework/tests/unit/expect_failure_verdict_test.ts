/**
 * @module ExpectFailureVerdictTest
 * @path tests/scenario_framework/tests/unit/expect_failure_verdict_test.ts
 * @description Phase 142 Step 21 — an `expect_failure` step whose command unexpectedly succeeds
 *   must fail its scenario.
 *
 *   Found by running the declared pack mutations for the first time (GAP-5). The mcp-client pack
 *   was reported green under a mutation that disabled the guard it exists to test, and the reason
 *   was not the pack: `dynamic-write-tool-boundary` correctly went from 1.000 to **0.000**, and
 *   the runner still printed `Outcome: success` and a ✅.
 *
 *   The inversion is a two-step handoff. `evaluateStepOutcome` marks the step failed at the
 *   EXECUTION stage; `toModeExecutionResult` then signals that failure by normalising the exit
 *   code to 1 — and `modes.ts` re-derives the verdict from the exit code through `expect_failure`
 *   semantics, where 1 means *the expected failure happened*. So the flag that says "this step
 *   failed" was read as "this step passed", and `criteriaFailed` is not set on the execution
 *   branch either, leaving the scenario outcome at `success`.
 *
 *   This is the same flag and the same class of inversion as the `expect_failure` defect Step 10
 *   fixed one function over, which is why the fix is an explicit signal rather than another
 *   exit-code convention: two layers cannot disagree about what an exit code means if neither is
 *   asked to interpret one.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/synthetic_runner.ts, tests/scenario_framework/runner/modes.ts]
 */

import { assertEquals } from "@std/assert";
import { runScenarioInMode } from "../../runner/modes.ts";
import type { IScenarioStepExecutionResult } from "../../runner/step_executor.ts";
import { type IScenarioStep, ScenarioExecutionMode, ScenarioStepType } from "../../schema/step_schema.ts";

function step(overrides: Partial<IScenarioStep> = {}): IScenarioStep {
  return {
    id: "validate-flow",
    type: ScenarioStepType.EXACTL,
    name: "A dynamic step granted a write-only tool must fail validation",
    command: "flow",
    args: ["validate", "write-tool-dynamic"],
    input_criteria: [],
    output_criteria: [],
    ...overrides,
  } as IScenarioStep;
}

function executionResult(
  overrides: Partial<IScenarioStepExecutionResult> = {},
): IScenarioStepExecutionResult {
  return {
    stepId: "validate-flow",
    stepType: ScenarioStepType.EXACTL,
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    durationMs: 1,
    exitCode: 0,
    stdout: "",
    stderr: "",
    combinedOutput: "",
    ...overrides,
  };
}

Deno.test("[expect-failure] an execution-stage failure fails the scenario even on an expect_failure step", async () => {
  // The exact shape the mutation produced: the step failed (the command succeeded when a refusal
  // was expected), and `toModeExecutionResult` normalised the exit code to 1 to say so.
  const result = await runScenarioInMode({
    scenarioId: "dynamic-write-tool-boundary",
    steps: [step({ expect_failure: true })],
    mode: ScenarioExecutionMode.AUTO,
    interactiveAllowed: false,
    executeStep: () => Promise.resolve(executionResult({ exitCode: 1, executionFailed: true })),
  });

  assertEquals(result.status, "failed");
  assertEquals(result.outcome, "scenario-failure");
});

Deno.test("[expect-failure] a genuine refusal still passes", async () => {
  // The behaviour that must not regress: the command exits non-zero because the product refused,
  // which is what the scenario asked for. No `executionFailed` flag is set.
  const result = await runScenarioInMode({
    scenarioId: "dynamic-write-tool-boundary",
    steps: [step({ expect_failure: true })],
    mode: ScenarioExecutionMode.AUTO,
    interactiveAllowed: false,
    executeStep: () => Promise.resolve(executionResult({ exitCode: 1 })),
  });

  assertEquals(result.status, "completed");
});

Deno.test("[expect-failure] an unexpected success with no explicit signal is still caught by exit code", async () => {
  // The pre-existing rule stays in force for callers that do not set the flag: a zero exit on an
  // expect_failure step is a failure.
  const result = await runScenarioInMode({
    scenarioId: "dynamic-write-tool-boundary",
    steps: [step({ expect_failure: true })],
    mode: ScenarioExecutionMode.AUTO,
    interactiveAllowed: false,
    executeStep: () => Promise.resolve(executionResult({ exitCode: 0 })),
  });

  assertEquals(result.status, "failed");
});

Deno.test("[expect-failure] an ordinary step's execution failure is unaffected", async () => {
  const result = await runScenarioInMode({
    scenarioId: "dynamic-write-tool-boundary",
    steps: [step()],
    mode: ScenarioExecutionMode.AUTO,
    interactiveAllowed: false,
    executeStep: () => Promise.resolve(executionResult({ exitCode: 1, executionFailed: true })),
  });

  assertEquals(result.status, "failed");
});

Deno.test("[expect-failure] an ordinary passing step still completes", async () => {
  const result = await runScenarioInMode({
    scenarioId: "dynamic-write-tool-boundary",
    steps: [step()],
    mode: ScenarioExecutionMode.AUTO,
    interactiveAllowed: false,
    executeStep: () => Promise.resolve(executionResult({ exitCode: 0 })),
  });

  assertEquals(result.status, "completed");
});
