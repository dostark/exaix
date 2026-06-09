/**
 * @module ScenarioFrameworkSyntheticRunner
 * @path tests/scenario_framework/runner/synthetic_runner.ts
 * @description Implements a lightweight synthetic scenario harness for
 * integration tests by composing the existing loader, step
 * execution, criterion evaluation, mode control, and manifest persistence.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/tests/integration/synthetic_runner_test.ts, tests/scenario_framework/runner/scenario_loader.ts]
 */

import { join } from "@std/path";
import { evaluateCriterion, evaluateStepOutcome, type IScenarioStepOutcome, StepFailureStage } from "./assertions.ts";
import { type IRunManifest, writeExecutionLog, writeRunManifest } from "./evidence_collector.ts";
import { computeStepScore, computeSuiteScore, type IStepScoreInput } from "./scoring.ts";
import { type IRunScenarioInModeResult, runScenarioInMode } from "./modes.ts";
import { type ILoadedScenario, loadScenarioFromYamlFile } from "./scenario_loader.ts";
import { executeScenarioStep, type IScenarioStepExecutionResult } from "./step_executor.ts";
import {
  CriterionPhase,
  CriterionStatus,
  type ICriterion,
  type ICriterionResult,
  type IScenarioStep,
  type ScenarioExecutionMode,
  ScenarioStepType,
} from "../schema/step_schema.ts";

export interface IRunSyntheticScenarioOptions {
  frameworkHome: string;
  scenarioPath: string;
  workspaceRoot: string;
  outputDir: string;
  mode: ScenarioExecutionMode;
  startStepIndex?: number;
  interactiveAllowed?: boolean;
  exactlExecutable?: string;
  env?: { [key: string]: string };
  portalAliases?: string[];
  verbose?: boolean;
}

export interface IRunSyntheticScenarioResult {
  loadedScenario: ILoadedScenario;
  stepOutcomes: IScenarioStepOutcome[];
  runResult: IRunScenarioInModeResult;
  manifest: IRunManifest;
  manifestPath: string;
  executionLogPath?: string;
}

export async function runSyntheticScenario(
  options: IRunSyntheticScenarioOptions,
): Promise<IRunSyntheticScenarioResult> {
  const loadedScenario = await loadScenarioFromYamlFile({
    frameworkHome: options.frameworkHome,
    scenarioPath: options.scenarioPath,
  });

  const envForExpansion = {
    ...Deno.env.toObject(),
    ...(options.env ?? {}),
    WORKSPACE_ROOT: options.workspaceRoot,
    FRAMEWORK_HOME: options.frameworkHome,
    EXA_CONFIG_PATH: join(options.workspaceRoot, "exa.config.toml"),
  };

  // Expand top-level portals for portability (e.g., using $FRAMEWORK_HOME)
  loadedScenario.scenario.portals = loadedScenario.scenario.portals.map((p) => ({
    ...p,
    source_path: expandInString(p.source_path, envForExpansion),
  }));

  const stepOutcomes: IScenarioStepOutcome[] = [];

  const runResult = await runScenarioInMode({
    scenarioId: loadedScenario.scenario.id,
    steps: loadedScenario.steps,
    mode: options.mode,
    interactiveAllowed: options.interactiveAllowed,
    startStepIndex: options.startStepIndex,
    executeStep: async ({ step }) => {
      const outcome = await executeSyntheticStep({
        step,
        workspaceRoot: options.workspaceRoot,
        exactlExecutable: options.exactlExecutable,
        requestFixturePath: loadedScenario.requestFixture.absolutePath,
        frameworkHome: options.frameworkHome,
        env: options.env,
        portalAliases: options.portalAliases ?? loadedScenario.scenario.portals.map((portal) => portal.alias),
        verbose: options.verbose,
      });

      stepOutcomes.push(outcome);

      return toModeExecutionResult(outcome);
    },
  });

  const manifest = buildRunManifest({
    loadedScenario,
    stepOutcomes,
    mode: options.mode,
    runResult,
  });
  const manifestPath = await writeRunManifest({
    outputDir: options.outputDir,
    manifest,
  });

  const executionLogPath = await writeExecutionLog({
    outputDir: options.outputDir,
    scenarioId: loadedScenario.scenario.id,
    stepOutcomes,
  });

  return {
    loadedScenario,
    stepOutcomes,
    runResult,
    manifest,
    manifestPath,
    executionLogPath,
  };
}

interface IExecuteSyntheticStepOptions {
  step: IScenarioStep;
  workspaceRoot: string;
  exactlExecutable?: string;
  requestFixturePath: string;
  frameworkHome: string;
  env?: { [key: string]: string };
  portalAliases: string[];
  verbose?: boolean;
}

async function executeSyntheticStep(
  options: IExecuteSyntheticStepOptions,
): Promise<IScenarioStepOutcome> {
  const env = {
    ...Deno.env.toObject(),
    ...(options.env ?? {}),
    ...(options.step.env ?? {}),
    REQUEST_FIXTURE: options.requestFixturePath,
    WORKSPACE_ROOT: options.workspaceRoot,
    EXA_SYSTEM_ROOT: options.workspaceRoot,
    FRAMEWORK_HOME: options.frameworkHome,
    EXA_CONFIG_PATH: join(options.workspaceRoot, "exa.config.toml"),
  };

  const resolvedStep = expandVariablesInStep(options.step, env);

  const inputResults = await evaluateInputCriteria({
    ...options,
    step: resolvedStep,
  });

  if (hasFailedCriterion(inputResults)) {
    return {
      stepId: options.step.id,
      status: CriterionStatus.FAILED,
      failureStage: CriterionPhase.INPUT,
      criterionResults: inputResults,
    };
  }

  const executionResult = await executeScenarioStep({
    step: resolvedStep,
    exactlExecutable: options.exactlExecutable,
    cwd: options.workspaceRoot,
    env,
    verbose: options.verbose,
  });

  const outputOutcome = await evaluateStepOutcome({
    workspaceRoot: options.workspaceRoot,
    step: resolvedStep,
    executionResult,
    env,
    portalAliases: options.portalAliases,
  });

  return {
    stepId: options.step.id,
    status: outputOutcome.status,
    failureStage: outputOutcome.failureStage,
    criterionResults: [...inputResults, ...outputOutcome.criterionResults],
    executionResult,
  };
}

async function evaluateInputCriteria(
  options: IExecuteSyntheticStepOptions,
): Promise<ICriterionResult[]> {
  const results: ICriterionResult[] = [];

  for (const criterion of options.step.input_criteria) {
    results.push(
      await evaluateCriterion({
        workspaceRoot: options.workspaceRoot,
        phase: CriterionPhase.INPUT,
        criterion,
        env: options.env,
        portalAliases: options.portalAliases,
      }),
    );
  }

  return results;
}

function hasFailedCriterion(results: ICriterionResult[]): boolean {
  return results.some((result) => result.status !== CriterionStatus.PASSED);
}

function toModeExecutionResult(
  outcome: IScenarioStepOutcome,
): IScenarioStepExecutionResult {
  if (outcome.executionResult === undefined) {
    const timestamp = new Date().toISOString();
    return {
      stepId: outcome.stepId,
      stepType: ScenarioStepType.SHELL,
      startedAt: timestamp,
      completedAt: timestamp,
      durationMs: 0,
      exitCode: 1,
      stdout: "",
      stderr: "",
      combinedOutput: "",
    };
  }

  if (outcome.status === CriterionStatus.PASSED) {
    return outcome.executionResult;
  }

  return {
    ...outcome.executionResult,
    exitCode: outcome.executionResult.exitCode === 0 ? 1 : outcome.executionResult.exitCode,
  };
}

interface IBuildRunManifestOptions {
  loadedScenario: ILoadedScenario;
  stepOutcomes: IScenarioStepOutcome[];
  mode: ScenarioExecutionMode;
  runResult: IRunScenarioInModeResult;
}

function buildRunManifest(options: IBuildRunManifestOptions): IRunManifest {
  const steps = options.stepOutcomes.map((outcome) => {
    // Execution failures score 0 regardless of input criteria results
    const stepScore = outcome.failureStage === "execution" ? 0 : computeStepScore(outcome.criterionResults);
    return {
      stepId: outcome.stepId,
      stepType: resolveStepType(options.loadedScenario.steps, outcome.stepId),
      executionStatus: mapExecutionStatus(outcome),
      criterionResults: outcome.criterionResults,
      score: stepScore,
    };
  });

  // Build step-score inputs for suite score computation
  const stepScores: IStepScoreInput[] = steps.map((s) => {
    const stepDef = options.loadedScenario.steps.find((st) => st.id === s.stepId);
    return {
      stepId: s.stepId,
      score: s.score ?? computeStepScore(s.criterionResults),
      step: stepDef ??
        {
          id: s.stepId,
          type: s.stepType as IScenarioStep["type"],
          continue_on_failure: false,
          input_criteria: [],
          output_criteria: [],
        },
    };
  });

  return {
    scenarioId: options.loadedScenario.scenario.id,
    pack: options.loadedScenario.scenario.pack,
    mode: options.mode,
    outcome: mapScenarioOutcome(options.runResult),
    suite_score: computeSuiteScore(stepScores),
    steps,
  };
}

function resolveStepType(
  steps: IScenarioStep[],
  stepId: string,
): IScenarioStep["type"] {
  const step = steps.find((candidate) => candidate.id === stepId);
  if (!step) {
    throw new Error(`synthetic manifest missing step definition: ${stepId}`);
  }

  return step.type;
}

function mapScenarioOutcome(runResult: IRunScenarioInModeResult): string {
  if (runResult.status === "completed") {
    return runResult.outcome ?? "success";
  }

  if (runResult.status === "failed") {
    return runResult.outcome ?? "scenario-failure";
  }

  if (runResult.status === "paused") {
    return "paused";
  }

  return runResult.skipReason ?? "skipped";
}

function mapExecutionStatus(outcome: IScenarioStepOutcome): string {
  if (outcome.status === CriterionStatus.PASSED) {
    return "passed";
  }

  if (outcome.failureStage === StepFailureStage.EXECUTION) {
    return "execution-failed";
  }

  return "failed";
}

type CriterionPathField = "path" | "target_file";

function expandVariablesInStep(step: IScenarioStep, env: Record<string, string>): IScenarioStep {
  return {
    ...step,
    command: step.command ? expandInString(step.command, env) : step.command,
    args: step.args?.map((arg) => expandInString(arg, env)),
    input_criteria: step.input_criteria.map((criterion: ICriterion) => {
      const updates: Partial<Record<CriterionPathField, string>> = {};
      if ("path" in criterion && typeof criterion.path === "string") {
        updates.path = expandInString(criterion.path, env);
      }
      if ("target_file" in criterion && typeof criterion.target_file === "string") {
        updates.target_file = expandInString(criterion.target_file, env);
      }
      return { ...criterion, ...updates } as ICriterion;
    }),
    output_criteria: step.output_criteria.map((criterion: ICriterion) => {
      const updates: Partial<Record<CriterionPathField, string>> = {};
      if ("path" in criterion && typeof criterion.path === "string") {
        updates.path = expandInString(criterion.path, env);
      }
      if ("target_file" in criterion && typeof criterion.target_file === "string") {
        updates.target_file = expandInString(criterion.target_file, env);
      }
      return { ...criterion, ...updates } as ICriterion;
    }),
  } as IScenarioStep;
}

function expandInString(str: string, env: Record<string, string>): string {
  if (!str) return str;
  let res = str;
  for (const [key, value] of Object.entries(env)) {
    res = res.replaceAll(`$${key}`, value);
  }
  return res;
}
