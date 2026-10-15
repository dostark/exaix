/**
 * @module IExaPaths
 * @path packages/core/src/config/paths.ts
 * @description Defines the standard directory structure and path resolution logic for the Exaix workspace and memory banks.
 * @architectural-layer Config
 * @related-files ["packages/schemas/src/config.ts", "packages/core/src/types/constants.ts"]
 */

import { join } from "@std/path";
import {
  DEFAULT_ACTIVE_PATH,
  DEFAULT_AGENTS_PATH,
  DEFAULT_ARCHIVE_PATH,
  DEFAULT_BLUEPRINTS_PATH,
  DEFAULT_MEMORY_PATH,
  DEFAULT_PLANS_PATH,
  DEFAULT_PORTALS_PATH,
  DEFAULT_REJECTED_PATH,
  DEFAULT_REQUESTS_PATH,
  DEFAULT_RUNTIME_PATH,
  DEFAULT_WORKSPACE_PATH,
} from "@exaix/shared";
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
  agents: string;
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

/** The `paths` fields `resolveMemoryExecutionRoot` reads — narrower than `IExaPaths` so callers with a partial config can use the helper. */
export interface IMemoryExecutionPaths {
  memory: string;
  memoryExecution: string;
}

export function getDefaultPaths(_root: string): IExaPaths {
  return {
    workspace: DEFAULT_WORKSPACE_PATH,
    runtime: DEFAULT_RUNTIME_PATH,
    memory: DEFAULT_MEMORY_PATH,
    portals: DEFAULT_PORTALS_PATH,
    blueprints: DEFAULT_BLUEPRINTS_PATH,
    active: DEFAULT_ACTIVE_PATH,
    archive: DEFAULT_ARCHIVE_PATH,
    plans: DEFAULT_PLANS_PATH,
    requests: DEFAULT_REQUESTS_PATH,
    rejected: DEFAULT_REJECTED_PATH,
    agents: DEFAULT_AGENTS_PATH,
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

// Resolve the execution-memory root. `paths.memoryExecution` may be a bare subfolder name
// (relative to `paths.memory`) or an already-composite root-relative path (contains a
// separator) — joining a composite value onto `paths.memory` would double it.
export function resolveMemoryExecutionRoot(paths: IMemoryExecutionPaths): string {
  return paths.memoryExecution.includes("/") ? paths.memoryExecution : join(paths.memory, paths.memoryExecution);
}
