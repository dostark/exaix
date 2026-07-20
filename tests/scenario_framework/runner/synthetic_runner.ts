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
import { ensureDir } from "@std/fs";
import { evaluateCriterion, evaluateStepOutcome, type IScenarioStepOutcome, StepFailureStage } from "./assertions.ts";
import { type IRunManifest, writeExecutionLog, writeRunManifest } from "./evidence_collector.ts";
import type { Opt, Reason } from "@exaix/core/types";
import { computeStepScore, computeSuiteScore, type IStepScoreInput } from "./scoring.ts";
import { type IRunScenarioInModeResult, runScenarioInMode } from "./modes.ts";
import { type ILoadedScenario, loadScenarioFromYamlFile } from "./scenario_loader.ts";
import {
  binIsOnPath,
  type ICellConfigTargets,
  type IRunnableStepGroup,
  MATRIX_START_DAEMON_STEP_ID,
  resolveCellConfig,
  resolveRunnableSteps,
} from "./matrix_expander.ts";
import { currentMaxRowid, executeScenarioStep, type IScenarioStepExecutionResult } from "./step_executor.ts";
import {
  CriterionPhase,
  CriterionStatus,
  type ICriterion,
  type ICriterionResult,
  type IScenarioStep,
  type ScenarioExecutionMode,
  ScenarioStepType,
} from "../schema/step_schema.ts";

export interface IBuildRunManifestOptions {
  loadedScenario: ILoadedScenario;
  stepOutcomes: IScenarioStepOutcome[];
  mode: ScenarioExecutionMode;
  runResult: IRunScenarioInModeResult;
  matrixCell?: { cellId?: string; provider?: string; model?: string };
}

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
  // Ensure the sandbox workspace exists before ANY step runs. With the sibling-of-repo default
  // (config.ts: <base>/exaix-sandboxes/<run-id>), workspace_path points at a directory that does
  // not exist yet, and the step executor spawns commands with it as cwd — a missing dir fails with
  // ENOENT ("No such cwd"). Matrix cells were covered by materializeCellConfig's ensureDir, but
  // non-matrix scenarios were not; create it here unconditionally so every run mode is covered.
  await ensureDir(options.workspaceRoot);

  const loadedScenario = await loadScenarioFromYamlFile({
    frameworkHome: options.frameworkHome,
    scenarioPath: options.scenarioPath,
  });

  const envForExpansion = {
    ...Deno.env.toObject(),
    ...(options.env ?? {}),
    WORKSPACE_ROOT: options.workspaceRoot,
    FRAMEWORK_HOME: options.frameworkHome,
    EXA_CONFIG_PATH: join(options.workspaceRoot, WORKSPACE_CONFIG_FILE),
  };

  // Expand top-level portals for portability (e.g., using $FRAMEWORK_HOME)
  loadedScenario.scenario.portals = loadedScenario.scenario.portals.map((p) => ({
    ...p,
    source_path: expandInString(p.source_path, envForExpansion),
  }));

  const stepOutcomes: IScenarioStepOutcome[] = [];

  // Phase 127 Step 5 — matrix-aware step resolution. For a `matrix:` scenario this
  // invokes expandMatrix() (closing its reachability ledger row); for a matrix-less
  // scenario it returns a single pass-through group with the original steps. The runner
  // executes the first runnable group (per-cell provider-live execution is gated/manual).
  const runnableGroups: IRunnableStepGroup[] = resolveRunnableSteps(loadedScenario.scenario, {
    env: envForExpansion,
    binOnPath: (bin) => binIsOnPath(bin),
    // The daemon resolves a relative EXA_CONFIG_PATH against its CWD (the workspace),
    // not the repo, so the cell's preset must be made absolute against the repo root
    // (frameworkHome/../..) before it is overlaid onto the start-daemon step.
    configBaseDir: join(options.frameworkHome, "..", ".."),
  });
  const firstRunnable = runnableGroups.find((g) => g.status === "run");
  let stepsToRun = firstRunnable?.steps ?? loadedScenario.steps;

  // Phase 127 Step 8 (LIVE-RT) + Phase 128: a scenario that boots a daemon on a dogfood preset
  // carrying deploy-time sentinels needs a sentinel-resolved copy materialized into the workspace
  // (root → workspace, worktree → the mounted portal) so the daemon roots where the runner submits
  // requests. This applies to BOTH matrix cells (preset from the cell `config:`) AND non-matrix
  // provider-live scenarios whose `start-daemon` step carries an EXA_CONFIG_PATH preset directly
  // (e.g. the Phase 128 hardening scenario). A matrix cell's preset path is already absolute (the
  // expander overlay resolved it); a non-matrix YAML preset path may contain $FRAMEWORK_HOME, so
  // expand the start-daemon step's EXA_CONFIG_PATH against the run env first. materializeCellConfig
  // is keyed on the start-daemon step and safely no-ops when no such step / EXA_CONFIG_PATH exists.
  stepsToRun = stepsToRun.map((step) =>
    step.id === MATRIX_START_DAEMON_STEP_ID && step.env?.EXA_CONFIG_PATH
      ? { ...step, env: { ...step.env, EXA_CONFIG_PATH: expandInString(step.env.EXA_CONFIG_PATH, envForExpansion) } }
      : step
  );
  stepsToRun = await materializeCellConfig(stepsToRun, {
    workspaceRoot: options.workspaceRoot,
    worktreePath: join(options.frameworkHome, "..", ".."),
  });

  // A trajectory-assert step declares `source_step: <id>` in YAML rather than a literal rowid
  // window (author-hostile and non-portable across runs). Track each step's own [start, end]
  // journal rowid window as it executes so a later trajectory-assert step can be scoped to
  // exactly its named source_step's execution — not the whole run, which would also capture
  // unrelated tool calls from prior/later steps.
  const stepRowidWindows = new Map<string, { start: number; end: number }>();

  let runResult: IRunScenarioInModeResult;
  try {
    runResult = await runScenarioInMode({
      scenarioId: loadedScenario.scenario.id,
      steps: stepsToRun,
      mode: options.mode,
      interactiveAllowed: options.interactiveAllowed,
      startStepIndex: options.startStepIndex,
      executeStep: async ({ step }) => {
        const resolvedStep = resolveTrajectorySourceStep(step, stepRowidWindows);

        const start = await currentMaxRowid(options.workspaceRoot);
        const outcome = await executeSyntheticStep({
          step: resolvedStep,
          workspaceRoot: options.workspaceRoot,
          exactlExecutable: options.exactlExecutable,
          requestFixturePath: loadedScenario.requestFixture.absolutePath,
          frameworkHome: options.frameworkHome,
          env: options.env,
          portalAliases: options.portalAliases ?? loadedScenario.scenario.portals.map((portal) => portal.alias),
          verbose: options.verbose,
        });
        const end = await currentMaxRowid(options.workspaceRoot);
        stepRowidWindows.set(step.id, { start, end });

        stepOutcomes.push(outcome);

        return toModeExecutionResult(outcome, step.step_pass_threshold);
      },
    });
  } finally {
    // A step's execution failure (e.g. a failing `run-tests` step) makes runScenarioInMode
    // return immediately (modes.ts) without ever reaching a later `stop-daemon` cleanup step,
    // leaking the daemon process this run started. `daemon stop` is idempotent (no-ops as
    // daemon.not_running when nothing is running), so it is always safe to force-invoke here
    // as a teardown guarantee whenever this run's steps include a start-daemon step.
    if (stepsToRun.some((step) => step.id === MATRIX_START_DAEMON_STEP_ID)) {
      await forceStopDaemon({
        workspaceRoot: options.workspaceRoot,
        exactlExecutable: options.exactlExecutable,
        env: options.env,
      });
    }
  }

  const manifest = buildRunManifest({
    loadedScenario,
    stepOutcomes,
    mode: options.mode,
    runResult,
    matrixCell: firstRunnable?.cell
      ? {
        cellId: `${firstRunnable.cell.tool}-${firstRunnable.cell.provider}`,
        provider: firstRunnable.cell.provider,
      }
      : undefined,
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

interface IForceStopDaemonOptions {
  workspaceRoot: string;
  exactlExecutable?: string;
  env?: { [key: string]: string };
}

/**
 * Best-effort daemon teardown, run unconditionally in a `finally` around scenario execution.
 * Swallows all errors: this is a leak guard, not a scored scenario step, and `daemon stop`
 * already no-ops cleanly when no daemon is running for this workspace.
 */
async function forceStopDaemon(options: IForceStopDaemonOptions): Promise<void> {
  try {
    await new Deno.Command(options.exactlExecutable ?? "exactl", {
      args: ["daemon", "stop"],
      cwd: options.workspaceRoot,
      env: options.env,
      stdin: "null",
      stdout: "piped",
      stderr: "piped",
    }).output();
  } catch {
    // Best-effort: nothing more to do if the teardown invocation itself fails to spawn.
  }
}

/** Where the runner writes the sentinel-resolved per-cell config (under the workspace `.exa`). */
/** The workspace's canonical config file — the single source of truth every step loads. */
const WORKSPACE_CONFIG_FILE = "exa.config.toml";

/**
 * Phase 127 Step 8 (LIVE-RT): for a runnable matrix cell, read the dogfood preset that the
 * `start-daemon` step's EXA_CONFIG_PATH points at, resolve its deploy-time sentinels
 * (`__DOGFOOD_ROOT__` → workspace, `__WORKTREE_PATH__` → the mounted portal) via
 * `resolveCellConfig`, and write the resolved config to the workspace's canonical
 * `exa.config.toml` — the SAME file every other step (add-portal, restart-daemon, submit-request)
 * loads via the baseEnv default. Writing one shared config is essential: `portal add` appends its
 * `[[portals]]` entry to whatever config EXA_CONFIG_PATH points at, and the daemon must run that
 * exact config to learn the portal — otherwise a request referencing `test-project` hits a daemon
 * whose config never registered it and stalls unprocessed. Because a running daemon does not hot-
 * reload config, the scenario follows the documented sequence (README §2.2): start-daemon →
 * add-portal → restart-daemon (stop+start, reloads the now-portal-bearing config) → submit-request.
 * The start-daemon step's EXA_CONFIG_PATH is repointed at the shared file. Runs BEFORE any step, so
 * every step sees one config. Works for BOTH in-repo (portal = repo) and a deployed sandbox with a
 * third-party portal. Steps without a start-daemon EXA_CONFIG_PATH are returned unchanged.
 */
export async function materializeCellConfig(
  steps: IScenarioStep[],
  targets: ICellConfigTargets,
): Promise<IScenarioStep[]> {
  const daemon = steps.find((s) => s.id === MATRIX_START_DAEMON_STEP_ID);
  const presetPath = daemon?.env?.EXA_CONFIG_PATH;
  if (!daemon || !presetPath) return steps;

  const presetText = await Deno.readTextFile(presetPath);
  const resolved = resolveCellConfig(presetText, targets);

  await ensureDir(targets.workspaceRoot);
  const materializedPath = join(targets.workspaceRoot, WORKSPACE_CONFIG_FILE);
  await Deno.writeTextFile(materializedPath, resolved);

  return steps.map((step) =>
    step.id === MATRIX_START_DAEMON_STEP_ID
      ? { ...step, env: { ...(step.env ?? {}), EXA_CONFIG_PATH: materializedPath } }
      : step
  );
}

/**
 * A trajectory-assert step's `source_step` names an earlier step by id; the schema requires it
 * but nothing previously resolved it into the `source_step_rowid_start`/`_end` fields
 * `executeScenarioStep` actually reads (step_executor.ts), which silently defaulted to (0, 0) —
 * scoring against an empty capture on every real run. Fills those fields from the named step's
 * own tracked rowid window (set in the caller's executeStep loop after that step ran). A
 * non-trajectory-assert step, or a source_step not yet seen (author error — validated by
 * scenario_schema.ts, not re-checked here), is returned unchanged.
 */
export function resolveTrajectorySourceStep(
  step: IScenarioStep,
  stepRowidWindows: Map<string, { start: number; end: number }>,
): IScenarioStep {
  if (step.type !== ScenarioStepType.TRAJECTORY_ASSERT || !step.source_step) return step;
  const window = stepRowidWindows.get(step.source_step);
  if (!window) return step;
  return { ...step, source_step_rowid_start: window.start, source_step_rowid_end: window.end };
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
  // Base env (without step.env) used to expand the step's own $VARS — incl. step.env values.
  const baseEnv = {
    ...Deno.env.toObject(),
    ...(options.env ?? {}),
    REQUEST_FIXTURE: options.requestFixturePath,
    WORKSPACE_ROOT: options.workspaceRoot,
    EXA_SYSTEM_ROOT: options.workspaceRoot,
    FRAMEWORK_HOME: options.frameworkHome,
    EXA_CONFIG_PATH: join(options.workspaceRoot, WORKSPACE_CONFIG_FILE),
  };

  const resolvedStep = expandVariablesInStep(options.step, baseEnv);

  // Merge the EXPANDED step.env last so values like EXA_MIGRATIONS_DIR resolve before
  // they reach the spawned process.
  const env = { ...baseEnv, ...(resolvedStep.env ?? {}) };

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
  stepPassThreshold?: Opt<number, Reason.OptionalInput>,
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

  // Only override exit code for execution failures, not criterion failures.
  // Criterion failures should be recorded for scoring but not halt the scenario —
  // instead they set criteriaFailed, which flips the FINAL scenario outcome to
  // scenario-failure (modes.ts) without stopping subsequent steps (e.g. cleanup).
  if (outcome.failureStage === StepFailureStage.EXECUTION) {
    return {
      ...outcome.executionResult,
      exitCode: outcome.executionResult.exitCode === 0 ? 1 : outcome.executionResult.exitCode,
    };
  }

  // Use step_pass_threshold when available: criteriaFailed only when step score
  // falls below the threshold. Default 1.0 preserves current binary semantics.
  const threshold = stepPassThreshold ?? 1.0;
  const stepScore = computeStepScore(outcome.criterionResults);
  return {
    ...outcome.executionResult,
    criteriaFailed: stepScore < threshold,
  };
}

export function buildRunManifest(options: IBuildRunManifestOptions): IRunManifest {
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
    ...(options.matrixCell
      ? {
        cellId: options.matrixCell.cellId,
        provider: options.matrixCell.provider,
        model: options.matrixCell.model,
      }
      : {}),
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

export function expandVariablesInStep(step: IScenarioStep, env: Record<string, string>): IScenarioStep {
  return {
    ...step,
    command: step.command ? expandInString(step.command, env) : step.command,
    args: step.args?.map((arg) => expandInString(arg, env)),
    // Expand $VARS in step.env values too (e.g. EXA_MIGRATIONS_DIR=$FRAMEWORK_HOME/...).
    env: step.env
      ? Object.fromEntries(
        Object.entries(step.env).map(([k, v]) => [k, expandInString(v, env)]),
      )
      : step.env,
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

/**
 * Expand `$VAR` and `${VAR}` references in a single pass, substituting each by the FULL
 * variable name. A single regex pass (not iterate-and-replaceAll over env keys) avoids the
 * prefix-collision bug where `$EXA_CONFIG` would corrupt `$EXA_CONFIG_PATH` to `<value>_PATH`
 * depending on key-iteration order. An unknown name is left untouched (preserved verbatim).
 */
function expandInString(str: string, env: Record<string, string>): string {
  if (!str) return str;
  return str.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g, (match, braced, bare) => {
    const name = braced ?? bare;
    const value = env[name];
    return value !== undefined ? value : match;
  });
}
