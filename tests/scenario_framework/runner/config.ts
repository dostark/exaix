/**
 * @module ScenarioFrameworkRunnerConfig
 * @path tests/scenario_framework/runner/config.ts
 * @description Defines runtime configuration, scenario selection precedence,
 * and portal lifecycle planning helpers for the scenario framework.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/schema/scenario_schema.ts, tests/scenario_framework/tests/unit/framework_contract_test.ts, tests/scenario_framework/README.md]
 */

import { resolve } from "@std/path";
import { z } from "zod";
import { ScenarioExecutionMode } from "../schema/step_schema.ts";
import type { JSONObject } from "@exaix/core/types";

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
}).strict();

export type IRuntimeConfig = z.infer<typeof RuntimeConfigSchema>;

export function loadRuntimeConfig(rawConfig: JSONObject): IRuntimeConfig {
  return RuntimeConfigSchema.parse(rawConfig);
}

export function resolveRuntimeConfigForExecution(
  options: IRuntimeConfigResolutionOptions,
): IRuntimeConfig {
  const fileConfig = options.fileConfig ?? {};
  const frameworkHome = resolve(fileConfig.framework_home ?? options.executionDirectory);
  const portals = normalizePortalPaths(fileConfig.portals);

  return RuntimeConfigSchema.parse({
    ...fileConfig,
    framework_home: frameworkHome,
    workspace_path: resolve(options.cliFlags?.workspace ?? fileConfig.workspace_path ?? ""),
    output_dir: resolve(options.cliFlags?.output ?? fileConfig.output_dir ?? ""),
    portals,
    mode: options.cliFlags?.mode ?? fileConfig.mode ?? ScenarioExecutionMode.AUTO,
    profile: options.cliFlags?.profile ?? fileConfig.profile,
    verbose: options.cliFlags?.verbose ?? fileConfig.verbose ?? false,
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
  portals?: { [key: string]: string },
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
