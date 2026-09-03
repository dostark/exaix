/**
 * @module GitTestingConfig
 * @path packages/git/testing/helpers/config.ts
 * @related-files []
 * @architectural-layer Services
 * @ungrounded
 * @description Minimal config helpers for git package test support.
 */

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
      runtime: overrides.paths?.runtime ?? "./.exa",
      memory: overrides.paths?.memory ?? "./Memory",
      portals: overrides.paths?.portals ?? "./Portals",
      blueprints: overrides.paths?.blueprints ?? "./Blueprints",
      active: overrides.paths?.active ?? "Active",
      archive: overrides.paths?.archive ?? "Archive",
      plans: overrides.paths?.plans ?? "Plans",
      requests: overrides.paths?.requests ?? "Requests",
      rejected: overrides.paths?.rejected ?? "Rejected",
      agents: overrides.paths?.agents ?? "Agents",
      flows: overrides.paths?.flows ?? "Blueprints/Flows",
      memoryProjects: overrides.paths?.memoryProjects ?? "Projects",
      memoryExecution: overrides.paths?.memoryExecution ?? "Execution",
      memoryIndex: overrides.paths?.memoryIndex ?? "Index",
      memorySkills: overrides.paths?.memorySkills ?? "Skills",
      memoryPending: overrides.paths?.memoryPending ?? "Pending",
      memoryTasks: overrides.paths?.memoryTasks ?? "Tasks",
      memoryGlobal: overrides.paths?.memoryGlobal ?? "Global",
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
