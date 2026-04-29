/**
 * @module ScenarioFrameworkExecutionModesTest
 * @path tests/scenario_framework/tests/unit/execution_modes_test.ts
 * @description RED-first tests for Step 4. Verifies execution state
 * persistence, step and manual-checkpoint mode behavior, auto fail-fast
 * control, and CI selection/skip handling before the mode engine exists.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/modes.ts, tests/scenario_framework/runner/config.ts, tests/scenario_framework/schema/step_schema.ts]
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import {
  ExecutionStateStatus,
  loadExecutionState,
  runScenarioInMode,
  selectScenariosForExecution,
  writeExecutionState,
} from "../../runner/modes.ts";
import { ScenarioCiProfile } from "../../runner/config.ts";
import { type IScenarioStep, ScenarioExecutionMode, ScenarioStepType } from "../../schema/step_schema.ts";

interface IScenarioSelectionCandidate {
  id: string;
  pack: string;
  tags: string[];
  mode_support: string[];
}

function createStep(id: string, overrides: Partial<IScenarioStep> = {}): IScenarioStep {
  return {
    id,
    type: ScenarioStepType.SHELL,
    command: Deno.execPath(),
    args: ["eval", `console.log(${JSON.stringify(id)});`],
    input_criteria: [],
    output_criteria: [],
    continue_on_failure: false,
    ...overrides,
  };
}

function createStepExecutor(
  executedStepIds: string[],
  options: { exitCode?: (stepId: string) => number; stderr?: (stepId: string) => string } = {},
): (opts: { step: IScenarioStep }) => Promise<{
  stepId: string;
  stepType: ScenarioStepType;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  exitCode: number;
  stdout: string;
  stderr: string;
  combinedOutput: string;
}> {
  const { exitCode = () => 0, stderr = () => "" } = options;
  return ({ step }) => {
    executedStepIds.push(step.id);
    return Promise.resolve({
      stepId: step.id,
      stepType: step.type,
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      durationMs: 0,
      exitCode: exitCode(step.id),
      stdout: step.id,
      stderr: stderr(step.id),
      combinedOutput: step.id,
    });
  };
}

Deno.test("[ScenarioFrameworkExecutionModes] runner state persists and resumes correctly from the expected next step after interruption", async () => {
  const stateDir = await Deno.makeTempDir({ prefix: "scenario-framework-state-" });

  try {
    const statePath = join(stateDir, "run-state.json");
    await writeExecutionState({
      statePath,
      state: {
        scenarioId: "step4-resume",
        mode: ScenarioExecutionMode.STEP,
        nextStepIndex: 1,
        executedStepIds: ["step-1"],
        status: ExecutionStateStatus.PAUSED,
      },
    });

    const restoredState = await loadExecutionState(statePath);

    assertEquals(restoredState.nextStepIndex, 1);
    assertEquals(restoredState.executedStepIds, ["step-1"]);
    assertEquals(restoredState.status, "paused");
  } finally {
    await Deno.remove(stateDir, { recursive: true });
  }
});

Deno.test("[ScenarioFrameworkExecutionModes] step mode executes exactly one step and then halts pending explicit continuation", async () => {
  const executedStepIds: string[] = [];
  const steps = [createStep("step-1"), createStep("step-2")];

  const result = await runScenarioInMode({
    scenarioId: "step-mode",
    steps,
    mode: ScenarioExecutionMode.STEP,
    executeStep: createStepExecutor(executedStepIds),
  });

  assertEquals(["step-1"], executedStepIds);
  assertEquals(result.status, "paused");
  assertEquals(result.nextStepIndex, 1);
});

Deno.test("[ScenarioFrameworkExecutionModes] manual-checkpoint mode pauses only at declared checkpoint steps and not at others", async () => {
  const executedStepIds: string[] = [];
  const steps = [
    createStep("step-1"),
    createStep("step-2", { checkpoint: "review-here" }),
    createStep("step-3"),
  ];

  const result = await runScenarioInMode({
    scenarioId: "manual-checkpoint",
    steps,
    mode: ScenarioExecutionMode.MANUAL_CHECKPOINT,
    executeStep: createStepExecutor(executedStepIds),
  });

  assertEquals(["step-1", "step-2"], executedStepIds);
  assertEquals(result.status, "paused");
  assertEquals(result.pauseReason, "checkpoint");
  assertEquals(result.nextStepIndex, 2);
  assertEquals(result.reviewBundle?.checkpointId, "review-here");
});

Deno.test("[ScenarioFrameworkExecutionModes] manual-checkpoint mode supports boolean checkpoint indicators", async () => {
  const executedStepIds: string[] = [];
  const steps = [
    createStep("step-1", { checkpoint: true }),
  ];

  const result = await runScenarioInMode({
    scenarioId: "boolean-checkpoint",
    steps,
    mode: ScenarioExecutionMode.MANUAL_CHECKPOINT,
    executeStep: createStepExecutor(executedStepIds),
  });

  assertEquals(["step-1"], executedStepIds);
  assertEquals(result.status, "paused");
  assertEquals(result.pauseReason, "checkpoint");
  assertEquals(result.reviewBundle?.checkpointId, true);
});

Deno.test("[ScenarioFrameworkExecutionModes] auto mode halts the scenario on the first failed step and records the manifest outcome", async () => {
  const executedStepIds: string[] = [];
  const steps = [createStep("step-1"), createStep("step-2"), createStep("step-3")];

  const result = await runScenarioInMode({
    scenarioId: "auto-mode",
    steps,
    mode: ScenarioExecutionMode.AUTO,
    executeStep: createStepExecutor(executedStepIds, {
      exitCode: (stepId) => (stepId === "step-2" ? 1 : 0),
      stderr: (stepId) => (stepId === "step-2" ? "failed" : ""),
    }),
  });

  assertEquals(executedStepIds, ["step-1", "step-2"]);
  assertEquals(result.status, "failed");
  assertEquals(result.outcome, "scenario-failure");
  assertEquals(result.nextStepIndex, 1);
});

Deno.test("[ScenarioFrameworkExecutionModes] CI mode rejects interactive-only scenarios with skip reason interactive-not-allowed", async () => {
  const result = await runScenarioInMode({
    scenarioId: "ci-skip",
    steps: [createStep("step-1")],
    mode: ScenarioExecutionMode.STEP,
    interactiveAllowed: false,
    executeStep: () => Promise.reject(new Error("should not execute interactive step mode in CI")),
  });

  assertEquals(result.status, "skipped");
  assertEquals(result.skipReason, "interactive-not-allowed");
});

Deno.test("[ScenarioFrameworkExecutionModes] scenario selection by pack, tag, and explicit id list each resolve the correct subset", () => {
  const scenarios: IScenarioSelectionCandidate[] = [
    { id: "scenario-a", pack: "agent_flows", tags: ["smoke", "analysis"], mode_support: ["auto"] },
    { id: "scenario-b", pack: "smoke", tags: ["smoke"], mode_support: ["auto"] },
    { id: "scenario-c", pack: "provider_live", tags: ["live"], mode_support: ["auto"] },
  ];

  const byId = selectScenariosForExecution({
    scenarios,
    explicitScenarioIds: ["scenario-c"],
    profile: ScenarioCiProfile.CORE,
  });
  const byPack = selectScenariosForExecution({
    scenarios,
    explicitPacks: ["agent_flows"],
    profile: ScenarioCiProfile.CORE,
  });
  const byTag = selectScenariosForExecution({
    scenarios,
    explicitTags: ["smoke"],
    profile: ScenarioCiProfile.CORE,
  });

  assertEquals(byId.map((scenario) => scenario.id), ["scenario-c"]);
  assertEquals(byPack.map((scenario) => scenario.id), ["scenario-a"]);
  assertEquals(byTag.map((scenario) => scenario.id), ["scenario-a", "scenario-b"]);
});
