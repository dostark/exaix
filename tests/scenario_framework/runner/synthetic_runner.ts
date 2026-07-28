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
import { readStepLlmMetrics } from "./step_llm_metrics.ts";
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
  /**
   * Explicit matrix cell selection by `tool` (e.g. "claude-code"), forwarded to
   * resolveRunnableSteps. Every non-matching cell is recorded skipped rather than run —
   * see IExpandMatrixOptions.selectedCell for why an explicit selection is required to run
   * more than one cell of the same matrix scenario (one invocation per --cell).
   */
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

/**
 * This file always lives within the Exaix repo at tests/scenario_framework/runner/.
 * Compute the repo root from this known location rather than from frameworkHome
 * (which may be a temp dir in tests).
 */
const REPO_ROOT = join(import.meta.dirname!, "..", "..", "..");

/**
 * Catalogs the daemon resolves against the WORKSPACE root rather than the repo, and which a
 * fresh sandbox therefore lacks entirely.
 *
 * `assertFlowExists` reads `<root>/Blueprints/Flows/<id>.flow.yaml` and `SkillsService` reads
 * `<root>/Memory/Skills`, so without these a flow request is rejected as "not found" and skill
 * matching runs against an empty catalog — neither of which looks like a missing-fixture
 * problem from the scenario's failure output. Seeded here for the same reason `setup_db.ts`
 * runs here: production has these in place before the daemon starts, and a scenario that has
 * to arrange them itself is testing its own setup.
 */
const SEEDED_CATALOGS: readonly (readonly [string, string])[] = [
  [join("Blueprints"), join("Blueprints")],
  [join("Memory", "Skills"), join("Memory", "Skills")],
] as const;

/**
 * Copy the shipped catalogs into a sandbox workspace, filling in only what is absent.
 *
 * Additive by design: a scenario that patches an identity inside its sandbox keeps the patch,
 * and an operator-supplied `--workspace` is never rewritten. Exported for direct testing.
 */
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

/**
 * Copy every entry of `source` that `destination` lacks, recursing into directories both have.
 *
 * Additive at the FILE level rather than the directory level. Skipping whenever the destination
 * directory merely existed was enough until the first full six-subsystem run: `model-registry-
 * team-cutover` copies the catalog itself (`cp -r … $WORKSPACE_ROOT/Blueprints`), and after it the
 * shared sandbox held a `Blueprints/` that seeding then refused to complete — so every later flow
 * scenario failed with "Flow 'analyze-codebase' not found". Per-pack runs never saw it, because
 * the scenario that creates the directory and the scenarios that need the catalog were never in
 * the same invocation.
 *
 * A file the destination already has is left exactly as it is, which preserves the Step 13
 * guarantee that a scenario's own patch to an identity survives seeding.
 */
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

/**
 * Copy a scenario's `flow_fixture` into the sandbox's flow catalog, named after the flow's own id.
 *
 * `assertFlowExists` resolves `<root>/Blueprints/Flows/<id>.flow.yaml`, so a fixture left in the
 * framework tree can never be requested — the scenario has to stage it. Eight scenarios declared
 * the field and none of them could: nothing read it, and `$FLOW_FIXTURE` expanded to nothing, so
 * `dynamic-permission-boundary`'s hand-rolled `cp` died on the literal `$FLOW_FIXTURE`. Doing it
 * here is the same move as mounting `portals:` and seeding the catalogs — setup the scenario
 * should not be testing.
 *
 * Overwrites: unlike the shipped catalogs, this file belongs to the scenario about to run, and a
 * stale copy from an earlier scenario sharing the sandbox would silently win.
 */
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
  const result = await new Deno.Command("git", { args, cwd, stdout: "null", stderr: "null" }).output();
  return result.success;
}

/**
 * Copy the portal fixtures into the sandbox and initialise each as a git repository.
 *
 * Portals are mutated ONLY through git worktrees (`PortalExecutionStrategy.WORKTREE`), so a
 * portal that is not a repo has nowhere isolated to put an agent's changes — it either bypasses
 * the isolation or writes straight into the portal root. All nine shipped fixtures were plain
 * directories, so no scenario exercised that invariant.
 *
 * Initialised here rather than committed to the repo: nested `.git` trees are awkward to carry,
 * and a per-run repository is what makes `git worktree add` safe to call concurrently across
 * scenarios sharing a sandbox. Skips any portal that is already a repo, so a second pass never
 * discards history an earlier scenario created.
 */
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
  const result = await new Deno.Command("git", { args, cwd, stdout: "piped", stderr: "null" }).output();
  return result.success ? new TextDecoder().decode(result.stdout).trim() : null;
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

/**
 * Names every portal whose default branch moved or whose working tree was dirtied.
 *
 * Portal mutation is supposed to happen ONLY inside a git worktree on its own branch —
 * `getExecutionStrategy` forces `PortalExecutionStrategy.WORKTREE` for every portal task, and
 * `GitService` refuses operations on protected branches. Neither guarantee was ever checked
 * against an actual run, and the failure is silent: a write that misses the worktree lands on
 * the portal's checked-out default branch and looks exactly like success. That became possible
 * only once portals were seeded as real repositories, so the check ships with the seeding.
 */
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
  // Ensure the sandbox workspace exists before ANY step runs. With the sibling-of-repo default
  // (config.ts: <base>/exaix-sandboxes/<run-id>), workspace_path points at a directory that does
  // not exist yet, and the step executor spawns commands with it as cwd — a missing dir fails with
  // ENOENT ("No such cwd"). Matrix cells were covered by materializeCellConfig's ensureDir, but
  // non-matrix scenarios were not; create it here unconditionally so every run mode is covered.
  await ensureDir(options.workspaceRoot);

  // Seed the catalogs the daemon resolves against the workspace root. Without them a flow
  // request is rejected as "Flow '<id>' not found" and skill matching scores against an empty
  // catalog — both of which surface as unrelated-looking scenario failures.
  await seedWorkspaceCatalogs(options.workspaceRoot, REPO_ROOT);
  await seedPortalFixtures(options.workspaceRoot, REPO_ROOT);
  await seedWorkspaceConfig(options.workspaceRoot, options.frameworkHome);
  const portalBaselines = await capturePortalBaselines(options.workspaceRoot);

  // Baseline for artefact correlation. Scenarios in a pack run share one sandbox workspace,
  // so a glob like `**/*_plan.md` matches every plan an earlier scenario left behind.
  // Captured at scenario entry, this timestamp separates "produced by this scenario" from
  // "left by a previous one", which is what makes the shared workspace safe without
  // per-scenario cleanup.
  const scenarioStartedAtMs = Date.now();

  // Run database migrations (setup_db.ts) so the sandbox's .exa/journal.db has all required
  // tables (activity, provider_costs, etc.). Without this step the daemon hits "no such table"
  // errors when the EventLogger or agent execution tries to write to missing tables. This must
  // happen BEFORE any start-daemon step since the daemon expects the schema to already exist
  // (production runs setup_db.ts before the daemon starts via the deploy pipeline).
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
  // Fatal, not a warning: a scenario running against an unmigrated database fails later on
  // whichever table it happens to touch first, which reads as an unrelated defect. Failing
  // here names the real cause once.
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

  // Expand top-level portals for portability (e.g., using $FRAMEWORK_HOME)
  loadedScenario.scenario.portals = loadedScenario.scenario.portals.map((p) => ({
    ...p,
    source_path: expandInString(p.source_path, envForExpansion),
  }));

  // Mount what the scenario declared. `portals:` has been parsed, validated and path-expanded
  // since the schema was written, and nothing ever acted on it — 20 scenarios declare portals
  // and each had to mount them itself with a shell step, or simply failed. `portal add` is
  // idempotent for an identical target, so re-mounting across a shared sandbox is safe.
  for (const portal of loadedScenario.scenario.portals) {
    await mountDeclaredPortal(portal, options, envForExpansion);
  }

  // Same story for `flow_fixture`: declared by eight scenarios, read by nothing.
  if (loadedScenario.scenario.flow_fixture) {
    await stageFlowFixture(
      options.workspaceRoot,
      resolve(options.frameworkHome, loadedScenario.scenario.flow_fixture),
    );
  }

  const stepOutcomes: IScenarioStepOutcome[] = [];

  // Phase 127 Step 5 — matrix-aware step resolution. For a `matrix:` scenario this
  // invokes expandMatrix() (closing its reachability ledger row); for a matrix-less
  // scenario it returns a single pass-through group with the original steps. The runner
  // executes the first runnable group; options.selectedCell narrows a multi-cell matrix
  // to one cell explicitly (see IExpandMatrixOptions.selectedCell) so a caller that wants
  // every cell exercised loops over cells itself, one invocation per --cell.
  const runnableGroups: IRunnableStepGroup[] = resolveRunnableSteps(loadedScenario.scenario, {
    env: envForExpansion,
    binOnPath: (bin) => binIsOnPath(bin),
    // The daemon resolves a relative EXA_CONFIG_PATH against its CWD (the workspace),
    // not the repo, so the cell's preset must be made absolute against the repo root
    // (frameworkHome/../..) before it is overlaid onto the start-daemon step.
    configBaseDir: REPO_ROOT,
    selectedCell: options.selectedCell,
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
  const materialized = await materializeCellConfig(stepsToRun, {
    workspaceRoot: options.workspaceRoot,
    worktreePath: REPO_ROOT,
  });
  stepsToRun = materialized.steps;

  // The cell config's own [ai].provider/[ai].model (parsed above) becomes $CELL_PROVIDER /
  // $CELL_MODEL for every step's existing $VAR expansion (executeSyntheticStep's baseEnv) —
  // so a scenario's judge-quality step can reference the config's real provider/model instead
  // of hardcoding a value that must be kept in sync with the config by hand.
  const cellEnv: { [key: string]: string } = { ...(options.env ?? {}) };
  if (materialized.aiProvider) cellEnv.CELL_PROVIDER = materialized.aiProvider;
  if (materialized.aiModel) cellEnv.CELL_MODEL = materialized.aiModel;
  const runEnv = Object.keys(cellEnv).length > 0 ? cellEnv : options.env;

  // A trajectory-assert step declares `source_step: <id>` in YAML rather than a literal rowid
  // window (author-hostile and non-portable across runs). Track each step's own [start, end]
  // journal rowid window as it executes so a later trajectory-assert step can be scoped to
  // exactly its named source_step's execution — not the whole run, which would also capture
  // unrelated tool calls from prior/later steps.
  const stepRowidWindows = new Map<string, { start: number; end: number }>();

  // Journal rowid captured before the PREVIOUS step ran, handed to a `wait-for-journal-event`
  // barrier as its baseline. A barrier that captured its own baseline at wait-start could not
  // see an event the step before it produced — which is exactly the case now that
  // `exactl daemon start` blocks until `daemon.ready` is journalled.
  let previousStepStartRowid = 0;

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
          artifactBaselineMs: scenarioStartedAtMs,
          journalBaselineRowid: previousStepStartRowid,
          maxStepTimeoutSec: options.maxStepTimeoutSec,
          exactlExecutable: options.exactlExecutable,
          requestFixturePath: loadedScenario.requestFixture.absolutePath,
          flowFixturePath: loadedScenario.scenario.flow_fixture
            ? resolve(options.frameworkHome, loadedScenario.scenario.flow_fixture)
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
    // A step's execution failure (e.g. a failing `run-tests` step) makes runScenarioInMode
    // return immediately (modes.ts) without ever reaching a later `stop-daemon` cleanup step,
    // leaking the daemon process this run started. `daemon stop` is idempotent (no-ops as
    // daemon.not_running when nothing is running), so it is always safe to force-invoke here
    // as a teardown guarantee whenever this run's steps include a start-daemon step.
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
        // Prefer the config-derived provider (materialized.aiProvider) over the cell's own
        // `provider:` field — the YAML field may be a $CELL_PROVIDER placeholder today, and
        // the config's [ai].provider is the actual source of truth for what ran regardless.
        cellId: `${firstRunnable.cell.tool}-${materialized.aiProvider ?? firstRunnable.cell.provider}`,
        provider: materialized.aiProvider ?? firstRunnable.cell.provider,
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

  // Portal mutation is supposed to happen only inside a worktree on its own branch. A write
  // that misses the worktree lands on the portal's checked-out default branch and otherwise
  // looks exactly like success, so it is surfaced loudly rather than left to a reviewer to
  // notice — the scenario's own criteria cannot see it.
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

/**
 * True when a step launches a daemon this run would be responsible for stopping.
 *
 * The teardown guard previously keyed on the step ID being exactly `start-daemon`, which misses
 * every scenario that starts one under another name — 25 use `restart-daemon`, and `restart`
 * delegates to `start`. Those leaked a daemon whenever they failed before their own stop step.
 * Keying on what the step DOES rather than what it is called removes the dependency on naming
 * convention, which nothing enforces.
 */
function startsADaemon(step: { id: string; command?: string; args?: string[] }): boolean {
  if (step.id === MATRIX_START_DAEMON_STEP_ID) return true;
  if (step.command !== "daemon") return false;
  return (step.args ?? []).some((arg) => arg === "start" || arg === "restart");
}

/**
 * Copy the framework's `exa.config.toml` into the sandbox when it has none of its own.
 *
 * The daemon writes a minimal default config on first start — `[system]` and `[watcher]` only —
 * so every config-gated behaviour was OFF in scenario runs regardless of what the framework
 * config declared. `[amendment] enabled = true` never reached the daemon, so no plan amendment
 * could ever be proposed and `plan-amendment-lifecycle` waited out its timeout for a file
 * nothing would write; `[session_delegate]` was equally absent. Never overwrites an existing
 * config, so a scenario that writes its own keeps it.
 */
async function seedWorkspaceConfig(workspaceRoot: string, frameworkHome: string): Promise<void> {
  const destination = join(workspaceRoot, WORKSPACE_CONFIG_FILE);
  try {
    await Deno.stat(destination);
    return; // the sandbox already has a config — leave it alone
  } catch { /* absent: seed it */ }
  try {
    await copy(join(frameworkHome, WORKSPACE_CONFIG_FILE), destination, { overwrite: false });
  } catch { /* framework config absent in this checkout */ }
}

/**
 * Mount a portal a scenario declared, so `portals:` means something.
 *
 * Best-effort and never fatal: a scenario whose declared source path does not exist should fail
 * on its own assertions with a legible message, not be aborted here by setup. The alias is
 * reported when the mount fails so the cause is not silent.
 */
async function mountDeclaredPortal(
  portal: { alias: string; source_path: string },
  options: IRunSyntheticScenarioOptions,
  env: { [key: string]: string },
): Promise<void> {
  try {
    const result = await new Deno.Command(options.exactlExecutable ?? "exactl", {
      args: ["portal", "add", portal.source_path, portal.alias],
      cwd: options.workspaceRoot,
      env,
      stdin: "null",
      stdout: "piped",
      stderr: "piped",
    }).output();
    if (!result.success) {
      console.warn(
        `%c ⚠ declared portal '${portal.alias}' could not be mounted from ${portal.source_path}`,
        "color: orange;",
      );
    }
  } catch {
    // Spawning the CLI failed; the scenario's own portal assertions will report it.
  }
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
 * The subset of a cell config's [ai] block this module extracts for $CELL_PROVIDER/$CELL_MODEL.
 * A parsed TOML document is not statically typed, so provider/model may be absent or (for a
 * malformed config) a non-string TOML value — the `typeof === "string"` guard at the call site
 * handles that case by treating it the same as "not present" rather than propagating a wrong type.
 */
interface IParsedAiBlock {
  ai?: { provider?: string; model?: string };
}

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
 *
 * Also parses the preset's own [ai].provider/[ai].model (the config's single source of truth for
 * which provider/model a cell runs) and returns them so scenario YAML steps can reference
 * $CELL_PROVIDER/$CELL_MODEL instead of hardcoding a provider/model string that must be kept in
 * sync with the config by hand — adding a new provider then means writing one new config file,
 * not hand-editing every scenario that exercises it.
 */
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
  /**
   * Epoch-ms floor separating this scenario's artefacts from those of earlier scenarios
   * sharing the sandbox workspace. Set to the scenario's start time.
   */
  artifactBaselineMs?: number;
  /** Journal rowid captured before the previous step ran — a barrier step's baseline. */
  journalBaselineRowid?: number;
  /** Upper bound applied to every step's `timeout_sec`; shortens only, never extends. */
  maxStepTimeoutSec?: number;
  exactlExecutable?: string;
  requestFixturePath: string;
  /** Absolute path of the scenario's `flow_fixture`, when it declares one — `$FLOW_FIXTURE`. */
  flowFixturePath?: string;
  frameworkHome: string;
  env?: { [key: string]: string };
  portalAliases: string[];
  verbose?: boolean;
}

/**
 * The `$VAR` names the runner defines for a step. Exported so the scenario tree can be checked
 * against the real table rather than a restatement of it: `expandInString` leaves an unknown
 * name verbatim (a shell local like `WORKTREE=$(...)` depends on that), so a name outside this
 * set does not fail at load — it reaches the step as the literal text `$NAME` and fails there.
 *
 * `CELL_PROVIDER`/`CELL_MODEL` are supplied per matrix cell via `options.env`, not here.
 */
export const SCENARIO_SUBSTITUTED_VARIABLES = [
  "REQUEST_FIXTURE",
  "FLOW_FIXTURE",
  "WORKSPACE_ROOT",
  "EXA_SYSTEM_ROOT",
  "FRAMEWORK_HOME",
  "EXA_CONFIG_PATH",
  "CELL_PROVIDER",
  "CELL_MODEL",
] as const;

async function executeSyntheticStep(
  options: IExecuteSyntheticStepOptions,
): Promise<IScenarioStepOutcome> {
  // Base env (without step.env) used to expand the step's own $VARS — incl. step.env values.
  const baseEnv = {
    ...Deno.env.toObject(),
    ...(options.env ?? {}),
    REQUEST_FIXTURE: options.requestFixturePath,
    // Defined only when the scenario declares `flow_fixture`; a step referencing it otherwise
    // keeps the literal `$FLOW_FIXTURE`, which is what the guard test forbids at author time.
    ...(options.flowFixturePath ? { FLOW_FIXTURE: options.flowFixturePath } : {}),
    WORKSPACE_ROOT: options.workspaceRoot,
    EXA_SYSTEM_ROOT: options.workspaceRoot,
    FRAMEWORK_HOME: options.frameworkHome,
    EXA_CONFIG_PATH: join(options.workspaceRoot, WORKSPACE_CONFIG_FILE),
  };

  const expandedStep = expandVariablesInStep(options.step, baseEnv);

  // A wait step's timeout is sized for a real run (120-180s). When iterating on a failure that
  // is already visible in seconds, those waits dominate the loop: the step is going to fail and
  // the only question is how long we pay to learn it. `--max-step-timeout` caps every step's
  // budget. It only ever SHORTENS a timeout, so it cannot make a step pass that would not have.
  const resolvedStep = options.maxStepTimeoutSec !== undefined
    ? {
      ...expandedStep,
      timeout_sec: Math.min(expandedStep.timeout_sec ?? options.maxStepTimeoutSec, options.maxStepTimeoutSec),
    }
    : expandedStep;

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
  });

  const outputOutcome = await evaluateStepOutcome({
    workspaceRoot: options.workspaceRoot,
    artifactBaselineMs: options.artifactBaselineMs,
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
    const llmMetrics = window ? await readStepLlmMetrics(options.workspaceRoot, window.start, window.end) : {};
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

  // Phase 141: include unexecuted steps with score 0 so an early failure (e.g.
  // wait-for-plan) correctly penalises the suite score instead of only scoring
  // the subset of steps that ran (e.g. 10/11 = 0.909). Build a set of executed
  // step IDs, then fill in any missing steps with score 0 and "skipped" status.
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

  return {
    scenarioId: options.loadedScenario.scenario.id,
    pack: options.loadedScenario.scenario.pack,
    // The field was declared, commented "propagated to eval history", read by `history_writer.ts`
    // and filtered on by `summarizeByTag` — and set by nobody, so every `eval_runs` row carried an
    // empty `tags` column and `eval report --group-by subsystem` reported "No matching summary
    // data found" after a full 72-scenario run. An empty group is indistinguishable from "no runs
    // yet", which is why nothing failed.
    tags: [...(options.loadedScenario.scenario.tags ?? [])],
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
