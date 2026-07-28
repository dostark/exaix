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
    // An explicit `executionFailed` outranks the exit code. The executor sets it when the step
    // failed at the EXECUTION stage, which on an `expect_failure` step includes "the command
    // succeeded when a refusal was expected" — a case whose normalised exit code (1) reads here
    // as the expected failure, inverting the verdict. Falling back to the exit code keeps the
    // rule intact for callers that do not set the flag.
    const isExecutionFailed = executionResult.executionFailed ??
      (expectFailure ? executionResult.exitCode === 0 : executionResult.exitCode !== 0);

    if (isExecutionFailed) {
      return {
        status: ExecutionStateStatus.FAILED,
        nextStepIndex: stepIndex,
        executedStepIds,
        outcome: ExecutionOutcome.SCENARIO_FAILURE,
      };
    }

    // A criterion (input/output_criteria) failure does not halt execution — subsequent
    // steps (e.g. daemon stop cleanup) still run — but it must flip the FINAL outcome
    // to scenario-failure once the run completes, instead of silently reporting
    // success at score 1.0 exit code while suite_score/step status disagree.
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
    // An excluded tag in the request is a MODIFIER — it turns the CI-safety filter off for what is
    // being asked about — not a thing to select. `--tag subsystem:mcp-client --tag provider-live`
    // otherwise unioned in every provider-live scenario from every pack, including all of
    // swe_tasks, which on a live tier is real money spent on the wrong scenarios.
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

/**
 * The tags that actually select, with the CI-safety escape tags removed.
 *
 * Falls back to the full list when nothing else was asked for: `--tag provider-live` alone is how
 * an operator requests the whole live tier, and there is nothing else it could mean.
 */
function selectorTags(requestedTags: string[]): string[] {
  const excluded = CI_EXCLUDED_TAGS as readonly string[];
  const selectors = requestedTags.filter((tag) => !excluded.includes(tag));
  return selectors.length > 0 ? selectors : requestedTags;
}

/**
 * Drop scenarios a mock-tier run cannot pass, unless the caller explicitly asked for them.
 *
 * `--tag` and `--pack` name a SET, and the caller means its runnable members. The filter used to
 * apply only on the profile-driven path, so every tag-scoped baseline in this phase was depressed
 * by `provider-live` and `manual-checkpoint` scenarios that were never going to pass — the flows
 * baseline of "3 of 28" included at least four of them.
 *
 * Requesting an excluded tag turns the filter off: the nightly recipe selects `--tag provider-live`,
 * and stripping exactly what was asked for would return nothing.
 */
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

/**
 * The environment a child runner process needs to select scenarios for a given edition.
 *
 * The counterpart of `filterByEdition` below, and it lives beside it deliberately: this module is
 * the one place that knows the edition is carried in the environment, so nothing else has to name
 * the variable. A caller launching a runner for an edition-gated pack asks for the env rather than
 * constructing it — without this, a Team-gated pack run with no edition set selects *nothing* and
 * reports a green pack over an empty selection.
 */
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
    // The per-change tier: one representative per subsystem, not the whole mock catalog.
    // It previously selected everything except the `provider_live` pack, which made it identical
    // to ci-extended (86 scenarios each on a Team build) — a cheap tier that costs the same as the
    // expensive one buys nothing, and the cadence it is supposed to implement was a fiction.
    // The parity gates that also belong to this tier are deno tests, run by `deno task test:parity`.
    return ciSafe.filter((scenario) => scenario.tags.includes(SMOKE_TAG));
  }

  return ciSafe;
}
