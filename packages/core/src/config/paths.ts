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
    flows: DEFAULTS.DEFAULT_FLOWS_PATH,
    memoryProjects: DEFAULTS.DEFAULT_PROJECTS_MEMORY_PATH,
    memoryExecution: DEFAULTS.DEFAULT_EXECUTION_MEMORY_PATH,
    memoryIndex: DEFAULTS.DEFAULT_INDEX_MEMORY_PATH,
    memorySkills: DEFAULTS.DEFAULT_SKILLS_MEMORY_PATH,
    memoryPending: DEFAULTS.DEFAULT_PENDING_MEMORY_PATH,
    memoryTasks: DEFAULTS.DEFAULT_TASKS_MEMORY_PATH,
    memoryGlobal: DEFAULTS.DEFAULT_GLOBAL_MEMORY_PATH,
  };
}
