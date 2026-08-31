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
  let anyCriteriaFailed = false;

  for (let stepIndex = startStepIndex; stepIndex < options.steps.length; stepIndex += 1) {
    const step = options.steps[stepIndex];
    const executionResult = await options.executeStep({ step, stepIndex });

    executedStepIds.push(step.id);

    const expectFailure = step.expect_failure ?? false;
    // `executionFailed` outranks the exit code: on an `expect_failure` step, "command succeeded
    // when a refusal was expected" also normalises to exit code 1, which would otherwise read as
    // the expected failure. The exit-code fallback only applies when the executor leaves the flag unset.
    const isExecutionFailed = executionResult.executionFailed ??
      (expectFailure ? executionResult.exitCode === 0 : executionResult.exitCode !== 0);

    if (isExecutionFailed) {
      // A step that declares `continue_on_failure` records its failure (the outcome is already
      // in stepOutcomes for a later judge's test_run_source) but does NOT halt the loop — the
      // scenario continues so e.g. an llm-judge still runs and grades the failing solution.
      if (!step.continue_on_failure) {
        return {
          status: ExecutionStateStatus.FAILED,
          nextStepIndex: stepIndex,
          executedStepIds,
          outcome: ExecutionOutcome.SCENARIO_FAILURE,
        };
      }
      anyCriteriaFailed = true;
    }

    // A criterion (input/output_criteria) failure does not halt execution, but it must flip the
    // FINAL outcome to scenario-failure once the run completes — otherwise a run can report
    // success at score 1.0 while suite_score/step status disagree.
    if (executionResult.criteriaFailed) {
      anyCriteriaFailed = true;
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

  if (anyCriteriaFailed) {
    return {
      status: ExecutionStateStatus.FAILED,
      nextStepIndex: options.steps.length,
      executedStepIds,
      outcome: ExecutionOutcome.SCENARIO_FAILURE,
    };
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
    // An operator pointing at one scenario always gets it, whatever its tags. Refusing would break
    // every debugging session, and a singleton selection has no baseline to protect.
    selected = options.scenarios.filter((scenario) => selection.scenarioIds.includes(scenario.id));
  } else if (selection.source === ScenarioSelectionSource.EXPLICIT_PACKS) {
    selected = applyCiSafety(
      options.scenarios.filter((scenario) => selection.packs.includes(scenario.pack)),
      selection.tags,
    );
  } else if (selection.source === ScenarioSelectionSource.EXPLICIT_TAGS) {
    // An excluded tag in the request is a MODIFIER that turns the CI-safety filter off for what is
    // asked about, not a thing to select — otherwise `--tag subsystem:mcp-client --tag provider-live`
    // unions in every provider-live scenario from every pack, real money spent on the wrong ones.
    const selectors = selectorTags(selection.tags);
    selected = applyCiSafety(
      options.scenarios.filter((scenario) => scenario.tags.some((tag) => selectors.includes(tag))),
      selection.tags,
    );
  } else {
    selected = filterByProfileDefaults(options.scenarios, selection);
  }

  return filterByEdition(selected);
}

/** Falls back to the full requested-tag list when removing CI-safety escape tags leaves nothing — `--tag provider-live` alone should mean the whole live tier, not an empty selection. */
function selectorTags(requestedTags: string[]): string[] {
  const excluded = CI_EXCLUDED_TAGS as readonly string[];
  const selectors = requestedTags.filter((tag) => !excluded.includes(tag));
  return selectors.length > 0 ? selectors : requestedTags;
}

/** `--tag`/`--pack` select a SET's runnable members only — but requesting an excluded tag itself turns the filter off, since stripping exactly what was asked for would return nothing. */
function applyCiSafety(scenarios: ISelectableScenario[], requestedTags: string[]): ISelectableScenario[] {
  const excluded = CI_EXCLUDED_TAGS as readonly string[];
  if (requestedTags.some((tag) => excluded.includes(tag))) {
    return scenarios;
  }
  return scenarios.filter((scenario) => {
    if (!scenario.mode_support.includes(ScenarioExecutionMode.AUTO)) return false;
    return !scenario.tags.some((tag) => excluded.includes(tag));
  });
}

/** Counterpart of `filterByEdition` below — this is the one place that knows the edition lives in env, so callers ask for it rather than constructing it; skip it and a Team-gated pack with no edition set silently selects nothing. */
export function editionEnv(edition: string): { [key: string]: string } {
  return { EXAIX_EDITION: edition };
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

/** Marks a scenario as its subsystem's cheap representative. */
const SMOKE_TAG = "smoke";

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
    return ciSafe.filter((scenario) => scenario.tags.includes(SMOKE_TAG));
  }

  if (selection.profile === ScenarioCiProfile.CORE) {
    // The per-change tier: one representative per subsystem, not the whole mock catalog. It used to
    // select everything except `provider_live`, identical to ci-extended (86 scenarios on a Team
    // build) — a cheap tier costing the same as the expensive one. Parity gates run via `deno task test:parity`.
    return ciSafe.filter((scenario) => scenario.tags.includes(SMOKE_TAG));
  }

  return ciSafe;
}
