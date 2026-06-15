/**
 * @module ScenarioFrameworkModes
 * @path tests/scenario_framework/runner/modes.ts
 * @description Provides the Step 4 execution-mode orchestration,
 * persisted runner state handling, and scenario selection filtering used by the
 * scenario framework.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/config.ts, tests/scenario_framework/runner/step_executor.ts, tests/scenario_framework/tests/unit/execution_modes_test.ts]
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
import { EDITION_SOLO } from "@exaix/core";

export enum ExecutionStateStatus {
  PAUSED = "paused",
  COMPLETED = "completed",
  FAILED = "failed",
  SKIPPED = "skipped",
}

export interface IExecutionState {
  scenarioId: string;
  mode: ScenarioExecutionMode;
  nextStepIndex: number;
  executedStepIds: string[];
  status: ExecutionStateStatus;
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

export enum ExecutionOutcome {
  SUCCESS = "success",
  SCENARIO_FAILURE = "scenario-failure",
}

export enum ExecutionSkipReason {
  INTERACTIVE_NOT_ALLOWED = "interactive-not-allowed",
}

export enum ExecutionPauseReason {
  STEP = "step",
  CHECKPOINT = "checkpoint",
}

export interface IRunScenarioInModeResult {
  status: ExecutionStateStatus;
  nextStepIndex: number;
  executedStepIds: string[];
  outcome?: ExecutionOutcome;
  skipReason?: ExecutionSkipReason;
  pauseReason?: ExecutionPauseReason;
  reviewBundle?: IReviewBundle;
}

export interface ISelectableScenario {
  id: string;
  pack: string;
  tags: string[];
  mode_support: string[];
  edition?: string;
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
      status: ExecutionStateStatus.SKIPPED,
      nextStepIndex: options.startStepIndex ?? 0,
      executedStepIds: [],
      skipReason: ExecutionSkipReason.INTERACTIVE_NOT_ALLOWED,
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
        status: ExecutionStateStatus.FAILED,
        nextStepIndex: stepIndex,
        executedStepIds,
        outcome: ExecutionOutcome.SCENARIO_FAILURE,
      };
    }

    if (options.mode === ScenarioExecutionMode.STEP) {
      return {
        status: ExecutionStateStatus.PAUSED,
        nextStepIndex: stepIndex + 1,
        executedStepIds,
        pauseReason: ExecutionPauseReason.STEP,
      };
    }

    if (options.mode === ScenarioExecutionMode.MANUAL_CHECKPOINT && step.checkpoint) {
      return {
        status: ExecutionStateStatus.PAUSED,
        nextStepIndex: stepIndex + 1,
        executedStepIds,
        pauseReason: ExecutionPauseReason.CHECKPOINT,
        reviewBundle: {
          checkpointId: step.checkpoint,
          stepId: step.id,
          executedStepIds: [...executedStepIds],
        },
      };
    }
  }

  return {
    status: ExecutionStateStatus.COMPLETED,
    nextStepIndex: options.steps.length,
    executedStepIds,
    outcome: ExecutionOutcome.SUCCESS,
  };
}

export function selectScenariosForExecution(
  options: IScenarioSelectionFilterOptions,
): ISelectableScenario[] {
  const selection = resolveScenarioSelection(options);

  let selected: ISelectableScenario[];

  if (selection.source === ScenarioSelectionSource.EXPLICIT_SCENARIO_IDS) {
    selected = options.scenarios.filter((scenario) => selection.scenarioIds.includes(scenario.id));
  } else if (selection.source === ScenarioSelectionSource.EXPLICIT_PACKS) {
    selected = options.scenarios.filter((scenario) => selection.packs.includes(scenario.pack));
  } else if (selection.source === ScenarioSelectionSource.EXPLICIT_TAGS) {
    selected = options.scenarios.filter((scenario) => scenario.tags.some((tag) => selection.tags.includes(tag)));
  } else {
    selected = filterByProfileDefaults(options.scenarios, selection);
  }

  return filterByEdition(selected);
}

function filterByEdition(scenarios: ISelectableScenario[]): ISelectableScenario[] {
  const currentEdition = Deno.env.get("EXAIX_EDITION") ?? EDITION_SOLO;
  return scenarios.filter((scenario) => {
    if (!scenario.edition) return true;
    return scenario.edition === currentEdition;
  });
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
