/**
 * @module ScenarioFrameworkModes
 * @path tests/scenario_framework/runner/modes.ts
 * @description Provides the Step 4 execution-mode orchestration,
 * persisted runner state handling, and scenario selection filtering used by the
 * scenario framework.
 * @architectural-layer Test
 * * @related-files [tests/scenario_framework/runner/config.ts, tests/scenario_framework/runner/step_executor.ts, tests/scenario_framework/tests/unit/execution_modes_test.ts]
 */

import {
  type IResolvedScenarioSelection,
  type IScenarioSelectionOptions,
  resolveScenarioSelection,
  ScenarioCiProfile,
  ScenarioSelectionSource,
} from "./config.ts";
import type { IScenarioStepExecutionResult } from "./step_executor.ts";
import { type IScenarioStep, ScenarioExecutionMode } from "../schema/step_schema.ts";
import { CI_EXCLUDED_TAGS } from "./scenario_catalog.ts";

export interface IExecutionState {
  scenarioId: string;
  mode: ScenarioExecutionMode;
  nextStepIndex: number;
  executedStepIds: string[];
  status: "paused" | "completed" | "failed" | "skipped";
}

export interface IExecutionStateWriteOptions {
  statePath: string;
  state: IExecutionState;
}

export interface IExecuteStepCallbackArgs {
  step: IScenarioStep;
  stepIndex: number;
}

export interface IReviewBundle {
  checkpointId: string | boolean;
  stepId: string;
  executedStepIds: string[];
}

export interface IRunScenarioInModeOptions {
  scenarioId: string;
  steps: IScenarioStep[];
  mode: ScenarioExecutionMode;
  interactiveAllowed?: boolean;
  startStepIndex?: number;
  executeStep: (args: IExecuteStepCallbackArgs) => Promise<IScenarioStepExecutionResult>;
}

export interface IRunScenarioInModeResult {
  status: "paused" | "completed" | "failed" | "skipped";
  nextStepIndex: number;
  executedStepIds: string[];
  outcome?: "success" | "scenario-failure";
  skipReason?: "interactive-not-allowed";
  pauseReason?: "step" | "checkpoint";
  reviewBundle?: IReviewBundle;
}

export interface ISelectableScenario {
  id: string;
  pack: string;
  tags: string[];
  mode_support: string[];
}

export interface IScenarioSelectionFilterOptions extends IScenarioSelectionOptions {
  scenarios: ISelectableScenario[];
  profile?: ScenarioCiProfile;
}

export async function writeExecutionState(options: IExecutionStateWriteOptions): Promise<void> {
  await Deno.writeTextFile(options.statePath, JSON.stringify(options.state, null, 2));
}

export async function loadExecutionState(statePath: string): Promise<IExecutionState> {
  const rawState = await Deno.readTextFile(statePath);
  return JSON.parse(rawState) as IExecutionState;
}

export async function runScenarioInMode(
  options: IRunScenarioInModeOptions,
): Promise<IRunScenarioInModeResult> {
  if (options.interactiveAllowed === false && isInteractiveMode(options.mode)) {
    return {
      status: "skipped",
      nextStepIndex: options.startStepIndex ?? 0,
      executedStepIds: [],
      skipReason: "interactive-not-allowed",
    };
  }

  const startStepIndex = options.startStepIndex ?? 0;
  const executedStepIds: string[] = [];

  for (let stepIndex = startStepIndex; stepIndex < options.steps.length; stepIndex += 1) {
    const step = options.steps[stepIndex];
    const executionResult = await options.executeStep({ step, stepIndex });

    executedStepIds.push(step.id);

    const expectFailure = step.expect_failure ?? false;
    const isFailed = expectFailure ? executionResult.exitCode === 0 : executionResult.exitCode !== 0;

    if (isFailed) {
      return {
        status: "failed",
        nextStepIndex: stepIndex,
        executedStepIds,
        outcome: "scenario-failure",
      };
    }

    if (options.mode === ScenarioExecutionMode.STEP) {
      return {
        status: "paused",
        nextStepIndex: stepIndex + 1,
        executedStepIds,
        pauseReason: "step",
      };
    }

    if (options.mode === ScenarioExecutionMode.MANUAL_CHECKPOINT && step.checkpoint) {
      return {
        status: "paused",
        nextStepIndex: stepIndex + 1,
        executedStepIds,
        pauseReason: "checkpoint",
        reviewBundle: {
          checkpointId: step.checkpoint,
          stepId: step.id,
          executedStepIds: [...executedStepIds],
        },
      };
    }
  }

  return {
    status: "completed",
    nextStepIndex: options.steps.length,
    executedStepIds,
    outcome: "success",
  };
}

export function selectScenariosForExecution(
  options: IScenarioSelectionFilterOptions,
): ISelectableScenario[] {
  const selection = resolveScenarioSelection(options);

  if (selection.source === ScenarioSelectionSource.EXPLICIT_SCENARIO_IDS) {
    return options.scenarios.filter((scenario) => selection.scenarioIds.includes(scenario.id));
  }

  if (selection.source === ScenarioSelectionSource.EXPLICIT_PACKS) {
    return options.scenarios.filter((scenario) => selection.packs.includes(scenario.pack));
  }

  if (selection.source === ScenarioSelectionSource.EXPLICIT_TAGS) {
    return options.scenarios.filter((scenario) => scenario.tags.some((tag) => selection.tags.includes(tag)));
  }

  return filterByProfileDefaults(options.scenarios, selection);
}

function isInteractiveMode(mode: ScenarioExecutionMode): boolean {
  return mode === ScenarioExecutionMode.STEP || mode === ScenarioExecutionMode.MANUAL_CHECKPOINT;
}

function filterByProfileDefaults(
  scenarios: ISelectableScenario[],
  selection: IResolvedScenarioSelection,
): ISelectableScenario[] {
  // Always filter to AUTO-supported and non-excluded tags for CI profiles
  const ciSafe = scenarios.filter((scenario) => {
    if (!scenario.mode_support.includes(ScenarioExecutionMode.AUTO)) {
      return false;
    }
    return !scenario.tags.some((tag) => (CI_EXCLUDED_TAGS as readonly string[]).includes(tag));
  });

  if (selection.profile === ScenarioCiProfile.SMOKE) {
    return ciSafe.filter((scenario) => scenario.tags.includes("smoke"));
  }

  if (selection.profile === ScenarioCiProfile.CORE) {
    return ciSafe.filter((scenario) => scenario.pack !== "provider_live");
  }

  return ciSafe;
}
