/**
 * @module PathsTestHelper
 * @path packages/testing/src/helpers/paths_helper.ts
 * @related-files []
 * @architectural-layer Testing
 * @ungrounded
 * @description Provides common utilities for resolving system paths during tests,
 * ensuring consistent identification of 'Blueprints', 'Requests', and 'Plans' roots.
 */

import { join } from "@std/path";
import { ExaPathDefaults } from "@exaix/core";

export function getWorkspaceDir(argDir: string): string {
  return join(argDir, ExaPathDefaults.workspace);
}

export function getWorkspaceActiveDir(argDir: string): string {
  return join(argDir, ExaPathDefaults.workspace, ExaPathDefaults.active);
}

export function getWorkspacePlansDir(argDir: string): string {
  return join(argDir, ExaPathDefaults.workspace, ExaPathDefaults.plans);
}

export function getWorkspaceRequestsDir(argDir: string): string {
  return join(argDir, ExaPathDefaults.workspace, ExaPathDefaults.requests);
}

export function getWorkspaceArchiveDir(argDir: string): string {
  return join(argDir, ExaPathDefaults.workspace, ExaPathDefaults.archive);
}

export function getWorkspaceRejectedDir(argDir: string): string {
  return join(argDir, ExaPathDefaults.workspace, ExaPathDefaults.rejected);
}

export function getRuntimeDir(argDir: string): string {
  return join(argDir, ExaPathDefaults.runtime);
}

export function getMemoryDir(argDir: string): string {
  return join(argDir, ExaPathDefaults.memory);
}

export function getBlueprintsIdentitiesDir(argDir: string): string {
  return join(argDir, ExaPathDefaults.blueprints, ExaPathDefaults.identities);
}

export function getMemoryExecutionDir(argDir: string): string {
  return join(argDir, ExaPathDefaults.memoryExecution);
}

export function getMemoryProjectsDir(argDir: string): string {
  return join(argDir, ExaPathDefaults.memoryProjects);
}

export function getMemoryGlobalDir(argDir: string): string {
  return join(argDir, ExaPathDefaults.memoryGlobal);
}

export function getMemoryIndexDir(argDir: string): string {
  return join(argDir, ExaPathDefaults.memoryIndex);
}

export function getMemorySkillsDir(argDir: string): string {
  return join(argDir, ExaPathDefaults.memorySkills);
}

export function getMemoryPendingDir(argDir: string): string {
  return join(argDir, ExaPathDefaults.memoryPending);
}

export function getMemoryTasksDir(argDir: string): string {
  return join(argDir, ExaPathDefaults.memoryTasks);
}

export function getPortalsDir(argDir: string): string {
  return join(argDir, ExaPathDefaults.portals);
}
