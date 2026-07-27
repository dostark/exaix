/**
 * @module ScenarioFrameworkRunnerConfig
 * @path tests/scenario_framework/runner/config.ts
 * @description Defines runtime configuration, scenario selection precedence,
 * and portal lifecycle planning helpers for the scenario framework.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/schema/scenario_schema.ts, tests/scenario_framework/tests/unit/framework_contract_test.ts, tests/scenario_framework/README.md]
 */

import { dirname, join, resolve } from "@std/path";
import { z } from "zod";
import { ScenarioExecutionMode } from "../schema/step_schema.ts";
import type { JSONObject, Opt, Reason } from "@exaix/core/types";
import { WorkspaceProvenance } from "./sandbox_lifecycle.ts";

export interface IScenarioSelectionOptions {
  explicitScenarioIds?: string[];
  explicitPacks?: string[];
  explicitTags?: string[];
  profile?: ScenarioCiProfile;
}

export interface IResolvedScenarioSelection {
  source: ScenarioSelectionSource;
  scenarioIds: string[];
  packs: string[];
  tags: string[];
  profile?: ScenarioCiProfile;
}

export interface IExistingPortalMount {
  alias: string;
  sourcePath: string;
  ownership: PortalOwnership;
}

export interface IPortalMountPlanInput {
  alias: string;
  desiredSourcePath: string;
  existingMount?: IExistingPortalMount;
  allowDestructiveRemount: boolean;
}

export interface IPortalMountPlan {
  action: PortalLifecycleAction;
  frameworkOwned: boolean;
}

export interface IRuntimeConfigResolutionOptions {
  executionDirectory: string;
  fileConfig?: Partial<IRuntimeConfig>;
  cliFlags?: IScenarioRunnerCliFlags;
}

const DEFAULT_RUNTIME_TIMEOUT_SEC = 120;
const NON_EMPTY_STRING = z.string().min(1);
const ABSOLUTE_PATH = z.string().min(1).startsWith("/");

// Sandbox default-location policy. When no explicit workspace_path is supplied, the runner
// must NOT fall back to the repo root (resolve("") === CWD), which leaks runtime state
// (.exa/journal.db, .logs/) into the working tree. Instead it deploys a sibling-of-repo
// sandbox under `<base>/<SANDBOX_DIR_NAME>/<run-id>`, where `<base>` is the EXA_SANDBOX_BASE
// env override when set, else the parent directory of the repo root.
const SANDBOX_BASE_ENV = "EXA_SANDBOX_BASE";
const SANDBOX_DIR_NAME = "exaix-sandboxes";
const SANDBOX_OUTPUT_SUBDIR = "output";

export enum ScenarioCiProfile {
  SMOKE = "ci-smoke",
  CORE = "ci-core",
  EXTENDED = "ci-extended",
}

export enum ScenarioSelectionSource {
  EXPLICIT_SCENARIO_IDS = "explicit-scenario-ids",
  EXPLICIT_PACKS = "explicit-packs",
  EXPLICIT_TAGS = "explicit-tags",
  PROFILE_DEFAULTS = "profile-defaults",
}

export enum PortalOwnership {
  FRAMEWORK = "framework",
  USER = "user",
}

export enum PortalLifecycleAction {
  CREATE_MISSING = "create-missing",
  REUSE_EXISTING = "reuse-existing",
  REMOUNT_DESTRUCTIVE = "remount-destructive",
}

export const RuntimeConfigSchema = z.object({
  workspace_path: ABSOLUTE_PATH,
  output_dir: ABSOLUTE_PATH,
  framework_home: ABSOLUTE_PATH.optional(),
  portals: z.record(z.string().min(1), ABSOLUTE_PATH).optional(),
  profile: z.nativeEnum(ScenarioCiProfile).optional(),
  mode: z.nativeEnum(ScenarioExecutionMode).default(ScenarioExecutionMode.AUTO),
  timeout_sec: z.number().int().positive().default(DEFAULT_RUNTIME_TIMEOUT_SEC),
  allow_dirty_workspace: z.boolean().default(false),
  verbose: z.boolean().default(false),
  /**
   * Phase 142 Step 16 — whether the runner minted `workspace_path` or the operator supplied it.
   * Cleanup reads this instead of guessing from the path: deciding by shape would delete a real
   * workspace the day someone points `--workspace` at a directory under the sandbox base.
   */
  workspace_provenance: z.nativeEnum(WorkspaceProvenance).default(WorkspaceProvenance.RUNNER_MINTED),
}).strict();

export type IRuntimeConfig = z.infer<typeof RuntimeConfigSchema>;

export function loadRuntimeConfig(rawConfig: JSONObject): IRuntimeConfig {
  return RuntimeConfigSchema.parse(rawConfig);
}

/**
 * Compute the default sibling-of-repo sandbox root for a run when no explicit workspace_path
 * is supplied. Base is `EXA_SANDBOX_BASE` if set, else the parent directory of the repo root
 * (the framework lives at `<repo>/tests/scenario_framework`, so the repo root is two levels
 * above frameworkHome). The run-id keeps concurrent/repeated runs isolated.
 */
function defaultSandboxRoot(frameworkHome: string, runId: string): string {
  const repoRoot = resolve(frameworkHome, "..", "..");
  const base = Deno.env.get(SANDBOX_BASE_ENV) ?? dirname(repoRoot);
  return join(resolve(base), SANDBOX_DIR_NAME, runId);
}

/**
 * Guard against routing runtime state into the repo tree. A resolved workspace root equal to
 * the repo root (the classic `resolve("")` === CWD leak) is rejected loudly so .exa/ and
 * .logs/ never contaminate the working tree.
 */
function assertNotRepoRoot(workspacePath: string, frameworkHome: string): void {
  const repoRoot = resolve(frameworkHome, "..", "..");
  if (workspacePath === repoRoot) {
    throw new Error(
      `Refusing to use the repo root as the sandbox workspace (${repoRoot}); ` +
        `pass an explicit --workspace or set ${SANDBOX_BASE_ENV} so runtime state stays out of the repo tree.`,
    );
  }
}

export function resolveRuntimeConfigForExecution(
  options: IRuntimeConfigResolutionOptions,
): IRuntimeConfig {
  const fileConfig = options.fileConfig ?? {};
  const frameworkHome = resolve(fileConfig.framework_home ?? options.executionDirectory);
  const portals = normalizePortalPaths(fileConfig.portals);

  // Workspace precedence: explicit CLI flag > file config > sibling-of-repo default (never CWD).
  const explicitWorkspace = options.cliFlags?.workspace ?? fileConfig.workspace_path;
  const runId = `${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
  const workspacePath = explicitWorkspace ? resolve(explicitWorkspace) : defaultSandboxRoot(frameworkHome, runId);

  assertNotRepoRoot(workspacePath, frameworkHome);

  // Output precedence mirrors workspace: explicit wins, else default UNDER the sandbox so all
  // run artifacts (evidence, manifest) live beside the workspace, never in the repo tree.
  const explicitOutput = options.cliFlags?.output ?? fileConfig.output_dir;
  const outputDir = explicitOutput ? resolve(explicitOutput) : join(workspacePath, SANDBOX_OUTPUT_SUBDIR);

  return RuntimeConfigSchema.parse({
    ...fileConfig,
    framework_home: frameworkHome,
    workspace_path: workspacePath,
    output_dir: outputDir,
    portals,
    mode: options.cliFlags?.mode ?? fileConfig.mode ?? ScenarioExecutionMode.AUTO,
    profile: options.cliFlags?.profile ?? fileConfig.profile,
    verbose: options.cliFlags?.verbose ?? fileConfig.verbose ?? false,
    workspace_provenance: explicitWorkspace ? WorkspaceProvenance.OPERATOR_SUPPLIED : WorkspaceProvenance.RUNNER_MINTED,
  });
}

export function resolveScenarioSelection(
  options: IScenarioSelectionOptions,
): IResolvedScenarioSelection {
  if ((options.explicitScenarioIds?.length ?? 0) > 0) {
    return {
      source: ScenarioSelectionSource.EXPLICIT_SCENARIO_IDS,
      scenarioIds: [...(options.explicitScenarioIds ?? [])],
      packs: [],
      tags: [],
      profile: options.profile,
    };
  }

  if ((options.explicitPacks?.length ?? 0) > 0) {
    return {
      source: ScenarioSelectionSource.EXPLICIT_PACKS,
      scenarioIds: [],
      packs: [...(options.explicitPacks ?? [])],
      tags: [],
      profile: options.profile,
    };
  }

  if ((options.explicitTags?.length ?? 0) > 0) {
    return {
      source: ScenarioSelectionSource.EXPLICIT_TAGS,
      scenarioIds: [],
      packs: [],
      tags: [...(options.explicitTags ?? [])],
      profile: options.profile,
    };
  }

  return {
    source: ScenarioSelectionSource.PROFILE_DEFAULTS,
    scenarioIds: [],
    packs: [],
    tags: [],
    profile: options.profile,
  };
}

export function planPortalMount(input: IPortalMountPlanInput): IPortalMountPlan {
  if (!input.existingMount) {
    return {
      action: PortalLifecycleAction.CREATE_MISSING,
      frameworkOwned: true,
    };
  }

  if (input.existingMount.alias !== input.alias) {
    throw new Error("existing mount alias does not match requested alias");
  }

  if (input.existingMount.sourcePath === input.desiredSourcePath) {
    return {
      action: PortalLifecycleAction.REUSE_EXISTING,
      frameworkOwned: input.existingMount.ownership === "framework",
    };
  }

  if (!input.allowDestructiveRemount) {
    throw new Error(`destructive remount blocked for alias: ${input.alias}`);
  }

  return {
    action: PortalLifecycleAction.REMOUNT_DESTRUCTIVE,
    frameworkOwned: true,
  };
}

export const ScenarioRunnerCliFlagSchema = z.object({
  config: NON_EMPTY_STRING.optional(),
  workspace: ABSOLUTE_PATH.optional(),
  output: ABSOLUTE_PATH.optional(),
  mode: z.nativeEnum(ScenarioExecutionMode).optional(),
  profile: z.nativeEnum(ScenarioCiProfile).optional(),
  scenario: z.array(NON_EMPTY_STRING).optional(),
  pack: z.array(NON_EMPTY_STRING).optional(),
  tag: z.array(NON_EMPTY_STRING).optional(),
  dry_run: z.boolean().optional(),
  verbose: z.boolean().optional(),
}).strict();

export type IScenarioRunnerCliFlags = z.infer<typeof ScenarioRunnerCliFlagSchema>;

function normalizePortalPaths(
  portals?: Opt<{ [key: string]: string }, Reason.OptionalInput>,
): { [key: string]: string } | undefined {
  if (!portals) {
    return undefined;
  }

  const normalizedPortals: { [key: string]: string } = {};
  for (const [alias, sourcePath] of Object.entries(portals)) {
    normalizedPortals[alias] = resolve(sourcePath);
  }

  return normalizedPortals;
}
