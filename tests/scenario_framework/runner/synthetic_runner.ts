/**
 * @module ScenarioFrameworkSyntheticRunner
 * @path tests/scenario_framework/runner/synthetic_runner.ts
 * @description Implements a lightweight synthetic scenario harness for
 * integration tests by composing the existing loader, step
 * execution, criterion evaluation, mode control, and manifest persistence.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/tests/integration/synthetic_runner_test.ts, tests/scenario_framework/runner/scenario_loader.ts]
 */

import { dirname, join, resolve } from "@std/path";
import { copy, ensureDir } from "@std/fs";
import { parse as parseToml } from "@std/toml";
import { parse as parseYaml } from "@std/yaml";
import { evaluateCriterion, evaluateStepOutcome, type IScenarioStepOutcome, StepFailureStage } from "./assertions.ts";
import { type IRunManifest, writeExecutionLog, writeRunManifest } from "./evidence_collector.ts";
import type { Opt, Reason } from "@exaix/core/types";
import { gitServiceFor } from "./git_helpers.ts";
import { composeGated, computeStepScore, computeSuiteScore, type IStepScoreInput, ScoringMode } from "./scoring.ts";
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
import { parseDelegateStepLlmMetrics, readStepLlmMetrics } from "./step_llm_metrics.ts";
import {
  ablateTag,
  BARE_DELEGATE_STEP_ID,
  HARNESS_BARE_TAG,
  REQUEST_FIXTURE_CONTENT_SENTINEL,
} from "./matrix_expander.ts";
import type { SessionTool } from "@exaix/schemas/session_delegate.ts";
import { CAPTURE_FIXTURES_ENV_VAR, sandboxCaptureFixturesDir } from "./capture_fixtures_flag.ts";
import {
  CriterionPhase,
  CriterionStatus,
  type ICriterion,
  type ICriterionResult,
  type IPortalMount,
  type IScenarioStep,
  type ScenarioExecutionMode,
  ScenarioStepType,
} from "../schema/step_schema.ts";

export interface IBuildRunManifestOptions {
  loadedScenario: ILoadedScenario;
  stepOutcomes: IScenarioStepOutcome[];
  mode: ScenarioExecutionMode;
  runResult: IRunScenarioInModeResult;
  matrixCell?: { cellId?: string; provider?: string; model?: string; tool?: string; harness?: "bare"; ablate?: string };
  /** The workspace root whose `.exa/journal.db` readStepLlmMetrics reads per step. */
  workspaceRoot: string;
  /** Each step's own [start, end] journal rowid window, tracked by the executeStep callback. */
  stepRowidWindows: Map<string, { start: number; end: number }>;
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
  /** Forwarded to resolveRunnableSteps; every non-matching cell is recorded skipped rather
   *  than run. See IExpandMatrixOptions.selectedCell for why one invocation runs one cell. */
  selectedCell?: string;
  /** Upper bound applied to every step's `timeout_sec`; shortens only, never extends. */
  maxStepTimeoutSec?: number;
}

export interface IRunSyntheticScenarioResult {
  loadedScenario: ILoadedScenario;
  stepOutcomes: IScenarioStepOutcome[];
  runResult: IRunScenarioInModeResult;
  manifest: IRunManifest;
  manifestPath: string;
  executionLogPath?: string;
}

export interface IMaterializedCellConfig {
  steps: IScenarioStep[];
  /** The cell config's [ai].provider, if present — for $CELL_PROVIDER expansion in scenario steps. */
  aiProvider?: string;
  /** The cell config's [ai].model, if present — for $CELL_MODEL expansion in scenario steps. */
  aiModel?: string;
}

/** Options for {@link buildStepBaseEnv} — a subset of IExecuteSyntheticStepOptions plus the
 *  scenario id, which the step-level options do not otherwise carry. */
export interface IStepBaseEnvOptions {
  scenarioId: string;
  stepId: string;
  requestFixturePath: string;
  /** Absolute path of the scenario's `flow_fixture`, when it declares one — `$FLOW_FIXTURE`. */
  flowFixturePath?: string;
  /** Absolute path of the scenario's `reference_patch`, when it declares one — `$REFERENCE_PATCH`. */
  referencePatchPath?: string;
  workspaceRoot: string;
  frameworkHome: string;
  env?: { [key: string]: string };
}

/** Computed from this file's own known location rather than from frameworkHome, which
 *  may be a temp dir in tests. */
const REPO_ROOT = join(import.meta.dirname!, "..", "..", "..");

/** Catalogs the daemon resolves against the WORKSPACE root rather than the repo, and which a
 *  fresh sandbox therefore lacks entirely — without these a flow request is rejected as
 *  "not found", which doesn't look like a missing-fixture problem from the failure output. */
const SEEDED_CATALOGS: readonly (readonly [string, string])[] = [
  [join("Blueprints"), join("Blueprints")],
  // The full shipped Memory tree (Skills + template banks), so scenarios never need a
  // `cp -r Memory` setup step — the daemon's runtime banks are written to the workspace at
  // run time and the seeded copy is only the shipped template.
  [join("Memory"), join("Memory")],
] as const;

/** Additive by design: a scenario that patches an agent role inside its sandbox keeps the
 *  patch, and an operator-supplied `--workspace` is never rewritten. */
export async function seedWorkspaceCatalogs(workspaceRoot: string, repoRoot: string): Promise<void> {
  for (const [from, to] of SEEDED_CATALOGS) {
    const source = join(repoRoot, from);
    try {
      await Deno.stat(source);
    } catch {
      continue; // not shipped in this checkout; nothing to seed
    }
    await seedMissingEntries(source, join(workspaceRoot, to));
  }
}

/** Additive at the FILE level, not the directory level — a file the destination already has
 *  is left exactly as it is, so a scenario's own patch to an agent role survives seeding. */
async function seedMissingEntries(source: string, destination: string): Promise<void> {
  await ensureDir(destination);
  for await (const entry of Deno.readDir(source)) {
    const from = join(source, entry.name);
    const to = join(destination, entry.name);
    const present = await Deno.lstat(to).then(() => true).catch(() => false);

    if (entry.isDirectory) {
      await seedMissingEntries(from, to);
      continue;
    }
    if (present) continue; // never overwrite what the sandbox already has
    await copy(from, to, { overwrite: false });
  }
}

/** A fixture left in the framework tree can never be requested by id — the scenario has to
 *  stage it. Overwrites: a stale copy from an earlier scenario sharing the sandbox would win. */
export async function stageFlowFixture(workspaceRoot: string, flowFixturePath: string): Promise<void> {
  const contents = await Deno.readTextFile(flowFixturePath);
  const declaredId = parseYaml(contents) as { id?: string } | null;
  const flowId = declaredId?.id;
  if (!flowId) {
    throw new Error(`flow fixture declares no id: ${flowFixturePath}`);
  }
  const flowsDir = join(workspaceRoot, "Blueprints", "Flows");
  await ensureDir(flowsDir);
  await Deno.writeTextFile(join(flowsDir, `${flowId}.flow.yaml`), contents);
}

/** Where the shipped portal fixtures live, and where a sandbox expects to find its own copy. */
const PORTAL_FIXTURES_SOURCE = join("tests", "scenario_framework", "fixtures", "portals");
const PORTAL_FIXTURES_DEST = join("fixtures", "portals");

/** Identity used for the base commit, passed per-invocation so no global git config is touched. */
const SEED_GIT_ARGS = ["-c", "user.email=scenario@exaix.local", "-c", "user.name=Scenario Framework"];

async function git(cwd: string, args: string[]): Promise<boolean> {
  const result = await gitServiceFor(cwd).runGitCommand(args, { throwOnError: false });
  return result.exitCode === 0;
}

/** Portals are mutated ONLY through git worktrees, so a non-repo portal has nowhere isolated
 *  to put an agent's changes. Initialised here, not committed: nested `.git` trees are awkward. */
export async function seedPortalFixtures(workspaceRoot: string, repoRoot: string): Promise<void> {
  const source = join(repoRoot, PORTAL_FIXTURES_SOURCE);
  try {
    await Deno.stat(source);
  } catch {
    return; // fixtures not present in this checkout
  }

  const destination = join(workspaceRoot, PORTAL_FIXTURES_DEST);
  await ensureDir(dirname(destination));
  await copy(source, destination, { overwrite: false }).catch(() => {});

  for await (const entry of Deno.readDir(destination)) {
    if (!entry.isDirectory) continue;
    const portal = join(destination, entry.name);
    try {
      await Deno.stat(join(portal, ".git"));
      continue; // already a repo — leave its history alone
    } catch { /* not yet initialised */ }

    await git(portal, [...SEED_GIT_ARGS, "init", "-q"]);
    await git(portal, [...SEED_GIT_ARGS, "add", "-A"]);
    await git(portal, [...SEED_GIT_ARGS, "commit", "-q", "-m", "chore(fixture): portal baseline"]);
  }
}

/** A portal's baseline: the commit its default branch pointed at when the sandbox was seeded. */
type PortalBaseline = { portal: string; head: string };

async function gitOut(cwd: string, args: string[]): Promise<string | null> {
  const result = await gitServiceFor(cwd).runGitCommand(args, { throwOnError: false });
  return result.exitCode === 0 ? result.output.trim() : null;
}

/** Record each seeded portal's default-branch HEAD, so drift can be detected after a run. */
export async function capturePortalBaselines(workspaceRoot: string): Promise<PortalBaseline[]> {
  const root = join(workspaceRoot, PORTAL_FIXTURES_DEST);
  const baselines: PortalBaseline[] = [];
  try {
    for await (const entry of Deno.readDir(root)) {
      if (!entry.isDirectory) continue;
      const head = await gitOut(join(root, entry.name), ["rev-parse", "HEAD"]);
      if (head) baselines.push({ portal: entry.name, head });
    }
  } catch { /* no portals seeded */ }
  return baselines;
}

/** Portal mutation is supposed to happen ONLY inside a git worktree on its own branch. The
 *  failure mode this guards is silent: a write that misses the worktree lands on the portal's
 *  checked-out default branch and looks exactly like success. */
export async function detectPortalDrift(
  workspaceRoot: string,
  baselines: readonly PortalBaseline[],
): Promise<string[]> {
  const root = join(workspaceRoot, PORTAL_FIXTURES_DEST);
  const drifted: string[] = [];
  for (const baseline of baselines) {
    const portal = join(root, baseline.portal);
    const head = await gitOut(portal, ["rev-parse", "HEAD"]);
    if (head !== null && head !== baseline.head) {
      drifted.push(`${baseline.portal}: default branch moved ${baseline.head.slice(0, 8)} -> ${head.slice(0, 8)}`);
      continue;
    }
    const status = await gitOut(portal, ["status", "--porcelain"]);
    if (status) drifted.push(`${baseline.portal}: working tree dirty (${status.split("\n").length} path(s))`);
  }
  return drifted;
}

export async function runSyntheticScenario(
  options: IRunSyntheticScenarioOptions,
): Promise<IRunSyntheticScenarioResult> {
  // Sandbox workspace may not exist yet (sibling-of-repo default), and the step executor
  // spawns commands with it as cwd — create it unconditionally so every run mode is covered.
  await ensureDir(options.workspaceRoot);

  // Without these, a flow request is rejected as "not found" and skill matching scores
  // against an empty catalog — both surface as unrelated-looking scenario failures.
  await seedWorkspaceCatalogs(options.workspaceRoot, REPO_ROOT);
  await seedPortalFixtures(options.workspaceRoot, REPO_ROOT);
  await seedWorkspaceConfig(options.workspaceRoot, options.frameworkHome);
  const portalBaselines = await capturePortalBaselines(options.workspaceRoot);

  // Baseline for artefact correlation: scenarios in a pack share one sandbox workspace, so
  // this timestamp separates "produced by this scenario" from "left by a previous one".
  const scenarioStartedAtMs = Date.now();

  // Must happen BEFORE any start-daemon step, since the daemon expects the schema (activity,
  // provider_costs, etc.) to already exist, or it hits "no such table" errors.
  const setupDbResult = await new Deno.Command("deno", {
    args: [
      "run",
      "-A",
      "--config",
      join(REPO_ROOT, "deno.json"),
      join(REPO_ROOT, "scripts", "setup_db.ts"),
    ],
    cwd: options.workspaceRoot,
    env: {
      EXA_MIGRATIONS_DIR: join(REPO_ROOT, "migrations"),
    },
  }).output();
  // Fatal, not a warning: an unmigrated database otherwise fails later on whichever table
  // it happens to touch first, reading as an unrelated defect.
  if (!setupDbResult.success) {
    throw new Error(
      `setup_db.ts failed with exit code ${setupDbResult.code} for workspace ${options.workspaceRoot}; ` +
        `the scenario database would be unmigrated.\n${new TextDecoder().decode(setupDbResult.stderr)}`,
    );
  }

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

  // Expand top-level portals for portability (e.g., using $FRAMEWORK_HOME / $WORKSPACE_ROOT)
  loadedScenario.scenario.portals = loadedScenario.scenario.portals.map((p) => ({
    ...p,
    source_path: expandInString(p.source_path, envForExpansion),
    ...(p.target_path ? { target_path: expandInString(p.target_path, envForExpansion) } : {}),
  }));

  // Same story for `flow_fixture`: declared by eight scenarios, read by nothing.
  if (loadedScenario.scenario.flow_fixture) {
    await stageFlowFixture(
      options.workspaceRoot,
      resolve(options.frameworkHome, loadedScenario.scenario.flow_fixture),
    );
  }

  const stepOutcomes: IScenarioStepOutcome[] = [];

  // Matrix-aware step resolution: for a `matrix:` scenario this expands to per-cell groups;
  // for a matrix-less scenario it returns a single pass-through group. The runner executes
  // the first runnable group; selectedCell narrows a multi-cell matrix to one cell explicitly.
  const runnableGroups: IRunnableStepGroup[] = resolveRunnableSteps(loadedScenario.scenario, {
    env: envForExpansion,
    binOnPath: (bin) => binIsOnPath(bin),
    // The daemon resolves a relative EXA_CONFIG_PATH against its CWD (the workspace), not the
    // repo, so the cell's preset must be made absolute against the repo root first.
    configBaseDir: REPO_ROOT,
    selectedCell: options.selectedCell,
  });
  const firstRunnable = runnableGroups.find((g) => g.status === "run");
  let stepsToRun = firstRunnable?.steps ?? loadedScenario.steps;

  // A scenario booting a daemon on a preset carrying deploy-time sentinels needs a
  // sentinel-resolved copy materialized into the workspace so the daemon roots where the
  // runner submits requests. materializeCellConfig no-ops when no such step/path exists.
  stepsToRun = stepsToRun.map((step) =>
    step.id === MATRIX_START_DAEMON_STEP_ID && step.env?.EXA_CONFIG_PATH
      ? { ...step, env: { ...step.env, EXA_CONFIG_PATH: expandInString(step.env.EXA_CONFIG_PATH, envForExpansion) } }
      : step
  );
  const materialized = await materializeCellConfig(stepsToRun, {
    workspaceRoot: options.workspaceRoot,
    worktreePath: REPO_ROOT,
  });
  stepsToRun = materialized.steps;

  // Runs AFTER materializeCellConfig so the `[[portals]]` entry lands in the config the
  // daemon actually boots with — mounting before it risks the entry being silently
  // overwritten by the materialized cell config, failing with "Portal not found".
  await prepareDeclaredPortals(loadedScenario.scenario.portals, options, envForExpansion);

  // Exposed as $CELL_PROVIDER/$CELL_MODEL for step $VAR expansion, so a judge-quality step
  // can reference the config's real provider/model instead of hardcoding one.
  const cellEnv: { [key: string]: string } = { ...(options.env ?? {}) };
  if (materialized.aiProvider) cellEnv.CELL_PROVIDER = materialized.aiProvider;
  if (materialized.aiModel) cellEnv.CELL_MODEL = materialized.aiModel;
  const runEnv = Object.keys(cellEnv).length > 0 ? cellEnv : options.env;

  // Tracks each step's own [start, end] journal rowid window as it executes, so a later
  // trajectory-assert step can scope to exactly its named source_step, not the whole run.
  const stepRowidWindows = new Map<string, { start: number; end: number }>();

  // Rowid before the PREVIOUS step ran, handed to a `journal wait --since-rowid` barrier as
  // its baseline — a barrier capturing its own baseline at wait-start would miss an event
  // the prior step produced.
  let previousStepStartRowid = 0;
  // The SCENARIO's baseline, captured once at start — the floor for $TRACE_ID/$REQUEST_ID
  // resolution. A per-step baseline would rise past the request and leave $REQUEST_ID unresolvable.
  const scenarioJournalBaselineRowid = await currentMaxRowid(options.workspaceRoot);

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
          scenarioId: loadedScenario.scenario.id,
          step: resolvedStep,
          workspaceRoot: options.workspaceRoot,
          artifactBaselineMs: scenarioStartedAtMs,
          journalBaselineRowid: previousStepStartRowid,
          traceBaselineRowid: scenarioJournalBaselineRowid,
          stepOutcomes,
          maxStepTimeoutSec: options.maxStepTimeoutSec,
          exactlExecutable: options.exactlExecutable,
          requestFixturePath: loadedScenario.requestFixture.absolutePath,
          flowFixturePath: loadedScenario.scenario.flow_fixture
            ? resolve(options.frameworkHome, loadedScenario.scenario.flow_fixture)
            : undefined,
          referencePatchPath: loadedScenario.scenario.reference_patch
            ? resolve(options.frameworkHome, loadedScenario.scenario.reference_patch)
            : undefined,
          frameworkHome: options.frameworkHome,
          env: runEnv,
          portalAliases: options.portalAliases ?? loadedScenario.scenario.portals.map((portal) => portal.alias),
          verbose: options.verbose,
        });
        const end = await currentMaxRowid(options.workspaceRoot);
        stepRowidWindows.set(step.id, { start, end });
        previousStepStartRowid = start;

        stepOutcomes.push(outcome);

        return toModeExecutionResult(outcome, step.step_pass_threshold);
      },
    });
  } finally {
    // A step failure makes runScenarioInMode return immediately without reaching a later
    // stop-daemon step, leaking the process. `daemon stop` is idempotent, so it is always
    // safe to force-invoke as a teardown guarantee.
    if (stepsToRun.some(startsADaemon)) {
      await forceStopDaemon({
        workspaceRoot: options.workspaceRoot,
        exactlExecutable: options.exactlExecutable,
        env: options.env,
      });
    }
  }

  const manifest = await buildRunManifest({
    loadedScenario,
    stepOutcomes,
    mode: options.mode,
    runResult,
    workspaceRoot: options.workspaceRoot,
    stepRowidWindows,
    matrixCell: firstRunnable?.cell
      ? {
        // Prefer the config-derived provider over the cell's own `provider:` field — the YAML
        // field may be a $CELL_PROVIDER placeholder, while [ai].provider is the source of
        // truth for what actually ran.
        cellId: firstRunnable.cell.harness === "bare"
          ? `bare/${firstRunnable.cell.tool}/${firstRunnable.cell.provider}`
          : firstRunnable.cell.ablate
          ? `ablate-${firstRunnable.cell.ablate}/${firstRunnable.cell.tool}/${firstRunnable.cell.provider}`
          : `${firstRunnable.cell.tool}-${materialized.aiProvider ?? firstRunnable.cell.provider}`,
        provider: materialized.aiProvider ?? firstRunnable.cell.provider,
        tool: firstRunnable.cell.tool,
        harness: firstRunnable.cell.harness,
        ablate: firstRunnable.cell.ablate,
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

  // A write that misses the worktree lands on the portal's checked-out default branch and
  // looks exactly like success, so it is surfaced loudly — the scenario's own criteria can't see it.
  const portalDrift = await detectPortalDrift(options.workspaceRoot, portalBaselines);
  if (portalDrift.length > 0) {
    console.error(
      `\n%c ⚠ portal drift — mutation escaped its worktree:\n   ${portalDrift.join("\n   ")}`,
      "color: red; font-weight: bold;",
    );
  }

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

/** Keys on what the step DOES (command/args), not its id — a step named `restart-daemon`
 *  still starts one, and nothing enforces a naming convention the teardown guard could trust. */
function startsADaemon(step: { id: string; command?: string; args?: string[] }): boolean {
  if (step.id === MATRIX_START_DAEMON_STEP_ID) return true;
  if (step.command !== "daemon") return false;
  return (step.args ?? []).some((arg) => arg === "start" || arg === "restart");
}

/** Without this, the daemon writes a minimal default config on first start, so config-gated
 *  behaviour stays OFF regardless of the framework config. Text-read-and-rewrite, not a plain
 *  copy, so a `$FRAMEWORK_HOME`-relative value expands to an absolute path. Never overwrites. */
export async function seedWorkspaceConfig(workspaceRoot: string, frameworkHome: string): Promise<void> {
  const destination = join(workspaceRoot, WORKSPACE_CONFIG_FILE);
  try {
    await Deno.stat(destination);
    return; // the sandbox already has a config — leave it alone
  } catch { /* absent: seed it */ }
  try {
    const template = await Deno.readTextFile(join(frameworkHome, WORKSPACE_CONFIG_FILE));
    const resolved = expandInString(template, { FRAMEWORK_HOME: frameworkHome, WORKSPACE_ROOT: workspaceRoot });
    await Deno.writeTextFile(destination, resolved);
  } catch { /* framework config absent in this checkout */ }
}

/** Git identity used for the initial commit in a staged fixture portal (mirrors the swe_tasks
 *  shell setup this staging replaces). */
const SWE_FIXTURE_GIT_IDENTITY = { email: "swe-tasks@exaix.dev", name: "swe-tasks" } as const;
/** Initial commit message for a staged fixture portal repo. */
const SWE_FIXTURE_COMMIT_MESSAGE = "init todo-app fixture";

/** True when a portal mount declares a fixture to stage into the workspace. */
function isFixturePortal(portal: IPortalMount): portal is IPortalMount & { target_path: string } {
  return typeof portal.target_path === "string";
}

/** A fixture mount is clean-staged first — a shared sandbox persists across scenarios/cells,
 *  and a non-resetting copy would leave the previous scenario's changes in the evaluated repo. */
async function prepareDeclaredPortals(
  portals: IPortalMount[],
  options: IRunSyntheticScenarioOptions,
  env: { [key: string]: string },
): Promise<void> {
  for (const portal of portals) {
    const source = expandInString(portal.source_path, env);
    const target = isFixturePortal(portal) ? expandInString(portal.target_path, env) : source;
    if (isFixturePortal(portal)) {
      await resetAndStageFixturePortal(portal, source, target, options.workspaceRoot);
    }
    await mountPortal(target, portal.alias, options, env);
  }
}

/** Clean-reset the evaluated repo: remove the prior target (and its .git), stale execution
 *  worktrees for the alias, and the stale symlink, then stage a fresh fixture copy. Exported
 *  for direct unit testing of the isolation guarantee. */
export async function resetAndStageFixturePortal(
  portal: IPortalMount & { target_path: string },
  source: string,
  target: string,
  workspaceRoot: string,
): Promise<void> {
  await removePath(target);
  await removePath(join(workspaceRoot, ".exa", "worktrees", portal.alias));
  await removePath(join(workspaceRoot, "Portals", portal.alias));
  await copyFixture(source, target);
  if (portal.git_init) {
    await gitInitFixtureRepo(target);
  }
}

/** Force-remove a path (file, symlink, or directory tree); absence is not an error. */
async function removePath(path: string): Promise<void> {
  try {
    await Deno.remove(path, { recursive: true });
  } catch {
    // Nothing to clean is fine — a fresh sandbox has no prior state.
  }
}

/** Recursively copy a fixture directory into the (already-cleared) target. */
async function copyFixture(source: string, target: string): Promise<void> {
  await ensureDir(dirname(target));
  await copy(source, target, { overwrite: true });
}

/** Initialize a git repo with the single initial fixture commit (same identity the scenario
 *  setup used, so execution worktrees/branches behave identically). */
async function gitInitFixtureRepo(repoPath: string): Promise<void> {
  const git = gitServiceFor(repoPath);
  await git.runGitCommand(["init", "-q"]);
  await git.runGitCommand(["add", "-A"]);
  await git.runGitCommand([
    "-c",
    `user.email=${SWE_FIXTURE_GIT_IDENTITY.email}`,
    "-c",
    `user.name=${SWE_FIXTURE_GIT_IDENTITY.name}`,
    "commit",
    "-q",
    "-m",
    SWE_FIXTURE_COMMIT_MESSAGE,
  ]);
}

/** Register a portal via `portal add` (idempotent for an identical target). Best-effort: a
 *  failed mount is surfaced as a warning and the scenario's own portal assertions report it. */
async function mountPortal(
  targetPath: string,
  alias: string,
  options: IRunSyntheticScenarioOptions,
  env: { [key: string]: string },
): Promise<void> {
  try {
    const result = await new Deno.Command(options.exactlExecutable ?? "exactl", {
      args: ["portal", "add", targetPath, alias],
      cwd: options.workspaceRoot,
      env,
      stdin: "null",
      stdout: "piped",
      stderr: "piped",
    }).output();
    if (!result.success) {
      console.warn(
        `%c ⚠ declared portal '${alias}' could not be mounted from ${targetPath}`,
        "color: orange;",
      );
    }
  } catch {
    // Spawning the CLI failed; the scenario's own portal assertions will report it.
  }
}

/** Swallows all errors: this is a leak guard, not a scored scenario step, and `daemon stop`
 *  already no-ops cleanly when no daemon is running for this workspace. */
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

/** The workspace's canonical config file — the single source of truth every step loads. */
const WORKSPACE_CONFIG_FILE = "exa.config.toml";

/** A parsed TOML document is not statically typed, so provider/model may be a non-string value
 *  for a malformed config — the `typeof === "string"` guard at the call site treats that the
 *  same as "not present" rather than propagating a wrong type. */
interface IParsedAiBlock {
  ai?: { provider?: string; model?: string };
}

/** Resolves the preset's deploy-time sentinels into the workspace's one shared config file,
 *  since the daemon doesn't hot-reload — `portal add`'s entry only takes effect after
 *  restart-daemon reloads it. Also returns [ai].provider/model for $CELL_PROVIDER/$CELL_MODEL. */
export async function materializeCellConfig(
  steps: IScenarioStep[],
  targets: ICellConfigTargets,
): Promise<IMaterializedCellConfig> {
  const daemon = steps.find((s) => s.id === MATRIX_START_DAEMON_STEP_ID);
  const presetPath = daemon?.env?.EXA_CONFIG_PATH;
  if (!daemon || !presetPath) return { steps };

  const presetText = await Deno.readTextFile(presetPath);
  const resolved = resolveCellConfig(presetText, targets);

  await ensureDir(targets.workspaceRoot);
  const materializedPath = join(targets.workspaceRoot, WORKSPACE_CONFIG_FILE);
  await Deno.writeTextFile(materializedPath, resolved);

  const resolvedSteps = steps.map((step) =>
    step.id === MATRIX_START_DAEMON_STEP_ID
      ? { ...step, env: { ...(step.env ?? {}), EXA_CONFIG_PATH: materializedPath } }
      : step
  );

  const parsedAi = (parseToml(resolved) as IParsedAiBlock).ai;
  return {
    steps: resolvedSteps,
    aiProvider: typeof parsedAi?.provider === "string" ? parsedAi.provider : undefined,
    aiModel: typeof parsedAi?.model === "string" ? parsedAi.model : undefined,
  };
}

/** Fills `source_step_rowid_start`/`_end` from the named step's own tracked rowid window,
 *  since executeScenarioStep reads those fields directly and they otherwise default to (0, 0),
 *  scoring against an empty capture. A non-trajectory-assert step is returned unchanged. */
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
  scenarioId: string;
  step: IScenarioStep;
  workspaceRoot: string;
  /** Epoch-ms floor separating this scenario's artefacts from earlier ones sharing the sandbox. */
  artifactBaselineMs?: number;
  /** Journal rowid captured before the previous step ran — a barrier step's baseline. */
  journalBaselineRowid?: number;
  /** The scenario-level journal baseline for `$TRACE_ID`/`$REQUEST_ID` resolution — see
   *  IExecuteScenarioStepOptions.traceBaselineRowid. */
  traceBaselineRowid?: number;
  /** Upper bound applied to every step's `timeout_sec`; shortens only, never extends. */
  maxStepTimeoutSec?: number;
  exactlExecutable?: string;
  requestFixturePath: string;
  /** Absolute path of the scenario's `flow_fixture`, when it declares one — `$FLOW_FIXTURE`. */
  flowFixturePath?: string;
  /** Absolute path of the scenario's `reference_patch`, when it declares one — `$REFERENCE_PATCH`. */
  referencePatchPath?: string;
  /** Outcomes of steps that already ran this scenario (a judge's test_run_source). */
  stepOutcomes?: IScenarioStepOutcome[];
  frameworkHome: string;
  env?: { [key: string]: string };
  portalAliases: string[];
  verbose?: boolean;
}

/** Exported so the scenario tree can be checked against the real table: `expandInString`
 *  leaves an unknown name verbatim, so a name outside this set reaches the step as the literal
 *  text `$NAME` and fails there instead of at load time. */
export const SCENARIO_SUBSTITUTED_VARIABLES = [
  "REQUEST_FIXTURE",
  "FLOW_FIXTURE",
  "REFERENCE_PATCH",
  "WORKSPACE_ROOT",
  "EXA_SYSTEM_ROOT",
  "FRAMEWORK_HOME",
  "EXA_CONFIG_PATH",
  "CELL_PROVIDER",
  "CELL_MODEL",
  // Resolved by the step executor at step-execution time (the worktree does not exist at
  // scenario load), NOT by expandInString — but it is a framework-supplied name, so a scenario
  // referencing `$WORKTREE` must be recognized as valid.
  "WORKTREE",
  // Substituted by the journal-assert step at execution time with the current request's trace.
  "TRACE_ID",
  // Substituted at step-execution time with `request-<trace[0:8]>` (review/plan approve key).
  "REQUEST_ID",
  // Substituted at step-execution time with the scenario's journal rowid baseline, so an
  // `exactl journal wait --since-rowid $JOURNAL_BASELINE` step ignores a prior scenario's events.
  "JOURNAL_BASELINE",
  // Substituted at step-execution time by expandFileContentSentinels — an exact-match
  // args-element swap to the request fixture's raw bytes, never shell-interpolated.
  "REQUEST_FIXTURE_CONTENT",
] as const;

/** Extracted from executeSyntheticStep so it can be asserted directly, without spawning a
 *  real daemon or exactl process. EXA_SCENARIO_ID/EXA_STEP_ID let a `submit-request` step
 *  stamp them into the created request's frontmatter, keying fixture replay by call site. */
export function buildStepBaseEnv(options: IStepBaseEnvOptions): Record<string, string> {
  // The daemon's write scope is its workspace tree; a --capture-fixtures dir pointing into the
  // repo would be denied with a NotCapable write error. Rewrite it into the sandbox — the
  // runner mirrors the captured files back after the run (copyCapturedFixtures).
  const requestedCaptureDir = Deno.env.get(CAPTURE_FIXTURES_ENV_VAR);
  return {
    ...Deno.env.toObject(),
    ...(options.env ?? {}),
    ...(requestedCaptureDir
      ? { [CAPTURE_FIXTURES_ENV_VAR]: sandboxCaptureFixturesDir(options.workspaceRoot, requestedCaptureDir) }
      : {}),
    REQUEST_FIXTURE: options.requestFixturePath,
    // Defined only when the scenario declares `flow_fixture`; a step referencing it otherwise
    // keeps the literal `$FLOW_FIXTURE`, which is what the guard test forbids at author time.
    ...(options.flowFixturePath ? { FLOW_FIXTURE: options.flowFixturePath } : {}),
    // Defined only when the scenario declares `reference_patch`; a step referencing it
    // otherwise keeps the literal `$REFERENCE_PATCH`, which the guard test forbids at author time.
    ...(options.referencePatchPath ? { REFERENCE_PATCH: options.referencePatchPath } : {}),
    WORKSPACE_ROOT: options.workspaceRoot,
    EXA_SYSTEM_ROOT: options.workspaceRoot,
    FRAMEWORK_HOME: options.frameworkHome,
    EXA_CONFIG_PATH: join(options.workspaceRoot, WORKSPACE_CONFIG_FILE),
    EXA_SCENARIO_ID: options.scenarioId,
    EXA_STEP_ID: options.stepId,
  };
}

async function executeSyntheticStep(
  options: IExecuteSyntheticStepOptions,
): Promise<IScenarioStepOutcome> {
  // Base env (without step.env) used to expand the step's own $VARS — incl. step.env values.
  const baseEnv = buildStepBaseEnv({
    scenarioId: options.scenarioId,
    stepId: options.step.id,
    requestFixturePath: options.requestFixturePath,
    flowFixturePath: options.flowFixturePath,
    referencePatchPath: options.referencePatchPath,
    workspaceRoot: options.workspaceRoot,
    frameworkHome: options.frameworkHome,
    env: options.env,
  });

  const expandedStep = expandVariablesInStep(options.step, baseEnv);
  // Bare-delegate steps carry the task content as a sentinel arg element — expand it to the
  // fixture's exact bytes AFTER env expansion.
  const contentExpandedStep = await expandFileContentSentinels(expandedStep, options.requestFixturePath);

  // A wait step's timeout is sized for a real run (120-180s), which dominates the loop when
  // iterating on a failure already visible in seconds. `--max-step-timeout` only ever
  // SHORTENS a timeout, so it cannot make a step pass that would not have.
  const resolvedStep = options.maxStepTimeoutSec !== undefined
    ? {
      ...contentExpandedStep,
      timeout_sec: Math.min(contentExpandedStep.timeout_sec ?? options.maxStepTimeoutSec, options.maxStepTimeoutSec),
    }
    : contentExpandedStep;

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
    artifactBaselineMs: options.artifactBaselineMs,
    journalBaselineRowid: options.journalBaselineRowid,
    traceBaselineRowid: options.traceBaselineRowid,
  });

  const outputOutcome = await evaluateStepOutcome({
    workspaceRoot: options.workspaceRoot,
    artifactBaselineMs: options.artifactBaselineMs,
    step: resolvedStep,
    executionResult,
    env,
    portalAliases: options.portalAliases,
    stepOutcomes: options.stepOutcomes,
    exactlExecutable: options.exactlExecutable,
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
        stepOutcomes: options.stepOutcomes,
        exactlExecutable: options.exactlExecutable,
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

  // Only override exit code for execution failures, not criterion failures — those set
  // criteriaFailed instead, which modes.ts turns into a scenario-failure without halting
  // subsequent steps (e.g. cleanup).
  if (outcome.failureStage === StepFailureStage.EXECUTION) {
    return {
      ...outcome.executionResult,
      exitCode: outcome.executionResult.exitCode === 0 ? 1 : outcome.executionResult.exitCode,
      // Say it, rather than leaving `modes.ts` to infer it from the normalised exit code above.
      // On an `expect_failure` step that inference is exactly backwards — see `executionFailed`.
      executionFailed: true,
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

export async function buildRunManifest(options: IBuildRunManifestOptions): Promise<IRunManifest> {
  const steps = await Promise.all(options.stepOutcomes.map(async (outcome) => {
    // Execution failures score 0 regardless of input criteria results
    const stepScore = outcome.failureStage === "execution" ? 0 : computeStepScore(outcome.criterionResults);
    const window = options.stepRowidWindows.get(outcome.stepId);
    // A bare cell's delegate step never writes journal rows (the delegate is an external CLI):
    // its cost/tokens come from the delegate's stdout via parseDelegateStepLlmMetrics instead.
    const isBareDelegate = options.matrixCell?.harness === "bare" &&
      outcome.stepId === BARE_DELEGATE_STEP_ID;
    const llmMetrics = window
      ? await readStepLlmMetrics(options.workspaceRoot, window.start, window.end)
      : isBareDelegate && options.matrixCell?.tool
      ? parseDelegateStepLlmMetrics(
        outcome.executionResult?.stdout ?? "",
        options.matrixCell.tool as SessionTool,
      )
      : {};
    return {
      stepId: outcome.stepId,
      stepType: resolveStepType(options.loadedScenario.steps, outcome.stepId),
      executionStatus: mapExecutionStatus(outcome),
      criterionResults: outcome.criterionResults,
      score: stepScore,
      durationMs: outcome.executionResult?.durationMs,
      llmDurationMs: llmMetrics.llmDurationMs,
      tokens: llmMetrics.tokens,
      trackedCostUsd: llmMetrics.trackedCostUsd,
    };
  }));

  // Include unexecuted steps with score 0 so an early failure (e.g. wait-for-plan)
  // penalises the suite score instead of only scoring the steps that ran (e.g. 10/11 = 0.909).
  const executedIds = new Set(options.stepOutcomes.map((o: IScenarioStepOutcome) => o.stepId));
  for (const fullStep of options.loadedScenario.steps) {
    if (executedIds.has(fullStep.id)) continue;
    steps.push({
      stepId: fullStep.id,
      stepType: fullStep.type,
      executionStatus: "skipped",
      score: 0,
      criterionResults: [],
      durationMs: undefined,
      llmDurationMs: undefined,
      tokens: undefined,
      trackedCostUsd: undefined,
    });
  }

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

  const scoringMode = options.loadedScenario.scenario.scoring ?? ScoringMode.ADDITIVE;
  const baseSuiteScore = computeSuiteScore(stepScores);

  return {
    scenarioId: options.loadedScenario.scenario.id,
    pack: options.loadedScenario.scenario.pack,
    // tags must be populated here — history_writer.ts and summarizeByTag both filter on it, and
    // a blank `tags` column makes `eval report --group-by subsystem` silently report no matching
    // data instead of failing.
    tags: [
      ...(options.loadedScenario.scenario.tags ?? []),
      ...(options.matrixCell?.harness === "bare" ? [HARNESS_BARE_TAG] : []),
      ...(options.matrixCell?.ablate ? [ablateTag(options.matrixCell.ablate)] : []),
    ],
    mode: options.mode,
    outcome: mapScenarioOutcome(options.runResult),
    // Under `scoring: gated`, the security gate multiplies the additive suite score
    // (gate = 0 iff any class:security criterion FAILED); additive mode uses identity.
    suite_score: scoringMode === ScoringMode.GATED
      ? composeGated(
        baseSuiteScore,
        steps.flatMap((s) => s.criterionResults ?? []),
      )
      : baseSuiteScore,
    scoringMode,
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

type CriterionPathField = "path" | "target_file" | "context_path";

function expandCriterionPathFields(criterion: ICriterion, env: Record<string, string>): ICriterion {
  const updates: Partial<Record<CriterionPathField, string>> = {};
  if ("path" in criterion && typeof criterion.path === "string") {
    updates.path = expandInString(criterion.path, env);
  }
  if ("target_file" in criterion && typeof criterion.target_file === "string") {
    updates.target_file = expandInString(criterion.target_file, env);
  }
  // llm-judge's context_path (e.g. "$REQUEST_FIXTURE") — the file whose content is passed
  // as the judge's context, so goal_alignment/request_understanding criteria can be scored
  // against the real stated objective instead of guessing from bare evidence content alone.
  if ("context_path" in criterion && typeof criterion.context_path === "string") {
    updates.context_path = expandInString(criterion.context_path, env);
  }
  return { ...criterion, ...updates } as ICriterion;
}

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
    input_criteria: step.input_criteria.map((criterion: ICriterion) => expandCriterionPathFields(criterion, env)),
    output_criteria: step.output_criteria.map((criterion: ICriterion) => expandCriterionPathFields(criterion, env)),
  } as IScenarioStep;
}

/**
 * Replaces the `$REQUEST_FIXTURE_CONTENT` sentinel in a step's args with the fixture's exact bytes, inserted as-is (never shell-interpolated); a step without the sentinel is returned unchanged.
 */
export async function expandFileContentSentinels(
  step: IScenarioStep,
  requestFixturePath: string,
): Promise<IScenarioStep> {
  const args = step.args;
  if (!args || !args.some((arg) => arg === REQUEST_FIXTURE_CONTENT_SENTINEL)) {
    return step;
  }
  const content = await Deno.readTextFile(requestFixturePath);
  return {
    ...step,
    args: args.map((arg) => (arg === REQUEST_FIXTURE_CONTENT_SENTINEL ? content : arg)),
  };
}

/**
 * A single regex pass (not iterate-and-replaceAll over env keys) avoids `$EXA_CONFIG` corrupting `$EXA_CONFIG_PATH`; unmatched names are left untouched.
 */
function expandInString(str: string, env: Record<string, string>): string {
  if (!str) return str;
  return str.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g, (match, braced, bare) => {
    const name = braced ?? bare;
    const value = env[name];
    return value !== undefined ? value : match;
  });
}
