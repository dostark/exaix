/**
 * @module IExaPaths
 * @path packages/core/src/config/paths.ts
 * @description Defines the standard directory structure and path resolution logic for the Exaix workspace and memory banks.
 * @architectural-layer Config
 * @related-files ["packages/schemas/src/config.ts", "packages/core/src/types/constants.ts"]
 */

import { join } from "@std/path";
import * as DEFAULTS from "../types/constants.ts";

export interface IExaPaths {
  workspace: string;
  runtime: string;
  memory: string;
  portals: string;
  blueprints: string;
  active: string;
  archive: string;
  plans: string;
  requests: string;
  rejected: string;
  identities: string;
  flows: string;
  waitStates: string;
  memoryProjects: string;
  memoryExecution: string;
  memoryIndex: string;
  memorySkills: string;
  memoryPending: string;
  memoryTasks: string;
  memoryGlobal: string;
}

/**
 * The `paths` fields `resolveMemoryExecutionRoot` reads.
 *
 * Narrower than `IExaPaths` so callers holding a partial config (or a test fixture) can use the
 * helper without constructing the full table.
 */
export interface IMemoryExecutionPaths {
  memory: string;
  memoryExecution: string;
}

export function getDefaultPaths(_root: string): IExaPaths {
  return {
    workspace: DEFAULTS.DEFAULT_WORKSPACE_PATH,
    runtime: DEFAULTS.DEFAULT_RUNTIME_PATH,
    memory: DEFAULTS.DEFAULT_MEMORY_PATH,
    portals: DEFAULTS.DEFAULT_PORTALS_PATH,
    blueprints: DEFAULTS.DEFAULT_BLUEPRINTS_PATH,
    active: DEFAULTS.DEFAULT_ACTIVE_PATH,
    archive: DEFAULTS.DEFAULT_ARCHIVE_PATH,
    plans: DEFAULTS.DEFAULT_PLANS_PATH,
    requests: DEFAULTS.DEFAULT_REQUESTS_PATH,
    rejected: DEFAULTS.DEFAULT_REJECTED_PATH,
    identities: DEFAULTS.DEFAULT_IDENTITIES_PATH,
    flows: DEFAULTS.ExaPathDefaults.flows,
    waitStates: DEFAULTS.DEFAULT_WAIT_STATES_PATH,
    memoryProjects: DEFAULTS.ExaPathDefaults.memoryProjects,
    memoryExecution: DEFAULTS.ExaPathDefaults.memoryExecution,
    memoryIndex: DEFAULTS.ExaPathDefaults.memoryIndex,
    memorySkills: DEFAULTS.ExaPathDefaults.memorySkills,
    memoryPending: DEFAULTS.ExaPathDefaults.memoryPending,
    memoryTasks: DEFAULTS.ExaPathDefaults.memoryTasks,
    memoryGlobal: DEFAULTS.ExaPathDefaults.memoryGlobal,
  };
}

/**
 * Resolve the execution-memory root from a `paths` record, tolerating both declared forms.
 *
 * `paths.memoryExecution` has shipped in two shapes. It defaulted to the bare `"Execution"`,
 * meaning *relative to `paths.memory`*, and Phase 142 Step 15 repointed the default to the
 * composite `"Memory/Execution"`, meaning *relative to the workspace root*. Configs and fixtures
 * carrying either value are still in the wild, so both must resolve — joining a composite value
 * onto `paths.memory` produces `Memory/Memory/Execution`, which is the failure this rule exists
 * to prevent.
 *
 * A value containing a separator is taken as already root-relative; a bare subfolder name is
 * joined onto `paths.memory`. The rule lived as five inline copies across `packages/core`,
 * `packages/flow` and `apps/exactl` before it lived here.
 *
 * @param paths - The `memory` and `memoryExecution` entries of a resolved config.
 * @returns The execution-memory directory, relative to the workspace root.
 */
export function resolveMemoryExecutionRoot(paths: IMemoryExecutionPaths): string {
  return paths.memoryExecution.includes("/") ? paths.memoryExecution : join(paths.memory, paths.memoryExecution);
}
