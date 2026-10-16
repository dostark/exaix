/**
 * @module SharedPaths
 * @path packages/shared/src/paths.ts
 * @description Builders for Exaix workspace paths. A caller passes the base directory and the
 *   trailing parts; the builder owns the default segment, so no caller joins a default itself.
 * @architectural-layer Shared
 * @dependencies [@std/path]
 * @related-files [packages/shared/src/constants.ts, packages/shared/mod.ts]
 */

import { join } from "@std/path";
import {
  DEFAULT_ACTIVE_PATH,
  DEFAULT_AGENTS_PATH,
  DEFAULT_ARCHIVE_PATH,
  DEFAULT_BLUEPRINTS_PATH,
  DEFAULT_EXECUTION_MEMORY_PATH,
  DEFAULT_FLOWS_PATH,
  DEFAULT_GLOBAL_MEMORY_PATH,
  DEFAULT_INDEX_MEMORY_PATH,
  DEFAULT_MEMORY_PATH,
  DEFAULT_PENDING_MEMORY_PATH,
  DEFAULT_PLANS_PATH,
  DEFAULT_PORTALS_PATH,
  DEFAULT_PROJECTS_MEMORY_PATH,
  DEFAULT_REJECTED_PATH,
  DEFAULT_REQUESTS_PATH,
  DEFAULT_RUNTIME_PATH,
  DEFAULT_SKILLS_MEMORY_PATH,
  DEFAULT_TASKS_MEMORY_PATH,
  DEFAULT_WORKSPACE_PATH,
} from "./constants.ts";

/** `<base>/Workspace[/parts]`. */
export function workspacePath(base: string, ...parts: readonly string[]): string {
  return join(base, DEFAULT_WORKSPACE_PATH, ...parts);
}

/** `<base>/.exa[/parts]`. */
export function runtimePath(base: string, ...parts: readonly string[]): string {
  return join(base, DEFAULT_RUNTIME_PATH, ...parts);
}

/** `<base>/Memory[/parts]`. */
export function memoryPath(base: string, ...parts: readonly string[]): string {
  return join(base, DEFAULT_MEMORY_PATH, ...parts);
}

/** `<base>/Portals[/parts]`. */
export function portalsPath(base: string, ...parts: readonly string[]): string {
  return join(base, DEFAULT_PORTALS_PATH, ...parts);
}

/** `<base>/Blueprints[/parts]`. */
export function blueprintsPath(base: string, ...parts: readonly string[]): string {
  return join(base, DEFAULT_BLUEPRINTS_PATH, ...parts);
}

/** `<workspace>/Active[/parts]`. */
export function activePath(workspaceBase: string, ...parts: readonly string[]): string {
  return join(workspaceBase, DEFAULT_ACTIVE_PATH, ...parts);
}

/** `<workspace>/Archive[/parts]`. */
export function archivePath(workspaceBase: string, ...parts: readonly string[]): string {
  return join(workspaceBase, DEFAULT_ARCHIVE_PATH, ...parts);
}

/** `<workspace>/Plans[/parts]`. */
export function plansPath(workspaceBase: string, ...parts: readonly string[]): string {
  return join(workspaceBase, DEFAULT_PLANS_PATH, ...parts);
}

/** `<workspace>/Requests[/parts]`. */
export function requestsPath(workspaceBase: string, ...parts: readonly string[]): string {
  return join(workspaceBase, DEFAULT_REQUESTS_PATH, ...parts);
}

/** `<workspace>/Rejected[/parts]`. */
export function rejectedPath(workspaceBase: string, ...parts: readonly string[]): string {
  return join(workspaceBase, DEFAULT_REJECTED_PATH, ...parts);
}

/** `<blueprints>/Agents[/parts]`. */
export function agentsPath(blueprintsBase: string, ...parts: readonly string[]): string {
  return join(blueprintsBase, DEFAULT_AGENTS_PATH, ...parts);
}

/** `<base>/Flows[/parts]`. */
export function flowsPath(base: string, ...parts: readonly string[]): string {
  return join(base, DEFAULT_FLOWS_PATH, ...parts);
}

/** `<memory>/Projects[/parts]`. */
export function memoryProjectsPath(memoryBase: string, ...parts: readonly string[]): string {
  return join(memoryBase, DEFAULT_PROJECTS_MEMORY_PATH, ...parts);
}

/** `<memory>/Execution[/parts]`. */
export function memoryExecutionPath(memoryBase: string, ...parts: readonly string[]): string {
  return join(memoryBase, DEFAULT_EXECUTION_MEMORY_PATH, ...parts);
}

/** `<memory>/Index[/parts]`. */
export function memoryIndexPath(memoryBase: string, ...parts: readonly string[]): string {
  return join(memoryBase, DEFAULT_INDEX_MEMORY_PATH, ...parts);
}

/** `<memory>/Skills[/parts]`. */
export function memorySkillsPath(memoryBase: string, ...parts: readonly string[]): string {
  return join(memoryBase, DEFAULT_SKILLS_MEMORY_PATH, ...parts);
}

/** `<memory>/Pending[/parts]`. */
export function memoryPendingPath(memoryBase: string, ...parts: readonly string[]): string {
  return join(memoryBase, DEFAULT_PENDING_MEMORY_PATH, ...parts);
}

/** `<memory>/Tasks[/parts]`. */
export function memoryTasksPath(memoryBase: string, ...parts: readonly string[]): string {
  return join(memoryBase, DEFAULT_TASKS_MEMORY_PATH, ...parts);
}

/** `<memory>/Global[/parts]`. */
export function memoryGlobalPath(memoryBase: string, ...parts: readonly string[]): string {
  return join(memoryBase, DEFAULT_GLOBAL_MEMORY_PATH, ...parts);
}
