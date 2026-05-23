/**
 * @module MemoryPathsHelper
 * @path packages/memory/testing/paths.ts
 * @related-files []
 * @architectural-layer Memory
 * @ungrounded
 * @description Memory-domain path utilities for resolving memory bank directory
 * paths from a root dir during tests.
 */

import { join } from "@std/path";
import { ExaPathDefaults } from "@exaix/core";

export function getMemoryDir(argDir: string): string {
  return join(argDir, ExaPathDefaults.memory);
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
