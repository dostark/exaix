/**
 * @module GitTestingConfig
 * @path packages/git/testing/helpers/config.ts
 * @related-files []
 * @architectural-layer Services
 * @ungrounded
 * @description Minimal config helpers for git package test support.
 */

import {
  DEFAULT_ACTIVE_PATH,
  DEFAULT_AGENTS_PATH,
  DEFAULT_ARCHIVE_PATH,
  DEFAULT_BLUEPRINTS_PATH,
  DEFAULT_EXECUTION_MEMORY_PATH,
  DEFAULT_FLOWS_DIR,
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
} from "@exaix/shared";
import { ConfigSchema } from "@exaix/schemas";
import { DEFAULT_TIMEOUT_MS } from "@exaix/core";

import type { Config } from "@exaix/schemas";

import { TEST_DEFAULT_BRANCH } from "./constants.ts";

export function createMockConfig(root: string, overrides: Partial<Config> = {}): Config {
  return ConfigSchema.parse({
    ...overrides,
    system: {
      ...(overrides.system ?? {}),
      root,
      version: overrides.system?.version ?? "1.0.0",
    },
    paths: {
      workspace: overrides.paths?.workspace ?? root,
      runtime: overrides.paths?.runtime ?? `./${DEFAULT_RUNTIME_PATH}`,
      memory: overrides.paths?.memory ?? `./${DEFAULT_MEMORY_PATH}`,
      portals: overrides.paths?.portals ?? `./${DEFAULT_PORTALS_PATH}`,
      blueprints: overrides.paths?.blueprints ?? `./${DEFAULT_BLUEPRINTS_PATH}`,
      active: overrides.paths?.active ?? DEFAULT_ACTIVE_PATH,
      archive: overrides.paths?.archive ?? DEFAULT_ARCHIVE_PATH,
      plans: overrides.paths?.plans ?? DEFAULT_PLANS_PATH,
      requests: overrides.paths?.requests ?? DEFAULT_REQUESTS_PATH,
      rejected: overrides.paths?.rejected ?? DEFAULT_REJECTED_PATH,
      agents: overrides.paths?.agents ?? DEFAULT_AGENTS_PATH,
      flows: overrides.paths?.flows ?? DEFAULT_FLOWS_DIR,
      memoryProjects: overrides.paths?.memoryProjects ?? DEFAULT_PROJECTS_MEMORY_PATH,
      memoryExecution: overrides.paths?.memoryExecution ?? DEFAULT_EXECUTION_MEMORY_PATH,
      memoryIndex: overrides.paths?.memoryIndex ?? DEFAULT_INDEX_MEMORY_PATH,
      memorySkills: overrides.paths?.memorySkills ?? DEFAULT_SKILLS_MEMORY_PATH,
      memoryPending: overrides.paths?.memoryPending ?? DEFAULT_PENDING_MEMORY_PATH,
      memoryTasks: overrides.paths?.memoryTasks ?? DEFAULT_TASKS_MEMORY_PATH,
      memoryGlobal: overrides.paths?.memoryGlobal ?? DEFAULT_GLOBAL_MEMORY_PATH,
      ...(overrides.paths ?? {}),
    },
    database: overrides.database ?? {
      batch_flush_ms: 100,
      batch_max_size: 100,
      sqlite: {
        journal_mode: "WAL",
        foreign_keys: true,
        busy_timeout_ms: 5000,
      },
      failure_threshold: 5,
      reset_timeout_ms: 60000,
      half_open_success_threshold: 2,
    },
    models: overrides.models ?? {
      default: { provider: "mock", model: "gpt-5.2-pro", timeout_ms: DEFAULT_TIMEOUT_MS },
    },
    provider_strategy: overrides.provider_strategy ?? { fallback_chains: {} },
    quality_gate: overrides.quality_gate ?? { enabled: false },
    portals: overrides.portals ?? [{
      alias: "workspace",
      target_path: root,
      default_branch: TEST_DEFAULT_BRANCH,
      agents_allowed: ["*"],
      operations: [],
    }],
  });
}
