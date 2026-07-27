/**
 * @module IExaPaths
 * @path packages/core/src/config/paths.ts
 * @description Defines the standard directory structure and path resolution logic for the Exaix workspace and memory banks.
 * @architectural-layer Config
 * @related-files ["packages/schemas/src/config.ts", "packages/core/src/types/constants.ts"]
 */

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
