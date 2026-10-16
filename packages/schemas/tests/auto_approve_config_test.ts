/**
 * @module AutoApproveConfigTest
 * @path packages/schemas/tests/auto_approve_config_test.ts
 * @related-files []
 * @architectural-layer Schemas
 * @description Tests for the [memory.auto_approve] configuration schema and parsing logic.
 */

import {
  DEFAULT_ACTIVE_PATH,
  DEFAULT_AGENTS_PATH,
  DEFAULT_ARCHIVE_PATH,
  DEFAULT_BLUEPRINTS_PATH,
  DEFAULT_FLOWS_DIR,
  DEFAULT_MEMORY_EXECUTION_DIR,
  DEFAULT_MEMORY_GLOBAL_DIR,
  DEFAULT_MEMORY_INDEX_DIR,
  DEFAULT_MEMORY_PATH,
  DEFAULT_MEMORY_PENDING_DIR,
  DEFAULT_MEMORY_PROJECTS_DIR,
  DEFAULT_MEMORY_SKILLS_DIR,
  DEFAULT_MEMORY_TASKS_DIR,
  DEFAULT_PLANS_PATH,
  DEFAULT_PORTALS_PATH,
  DEFAULT_REJECTED_PATH,
  DEFAULT_REQUESTS_PATH,
  DEFAULT_RUNTIME_PATH,
  DEFAULT_WORKSPACE_PATH,
} from "@exaix/shared";
import { assertEquals } from "@std/assert";
import { ConfigSchema } from "@exaix/schemas";

Deno.test("Step 71.1: Config schema includes auto_approve block with correct defaults", () => {
  const minimalConfig = {
    agents: { default_model: "gemini-flash" },
    models: { "gemini-flash": { provider: "google", model: "gemini-flash" } },
    system: { root: ".", version: "1.0.0", schema_version: "1.0.0" },
    paths: {
      memory: DEFAULT_MEMORY_PATH,
      blueprints: DEFAULT_BLUEPRINTS_PATH,
      runtime: DEFAULT_RUNTIME_PATH,
      workspace: DEFAULT_WORKSPACE_PATH,
      portals: DEFAULT_PORTALS_PATH,
      active: DEFAULT_ACTIVE_PATH,
      archive: DEFAULT_ARCHIVE_PATH,
      plans: DEFAULT_PLANS_PATH,
      requests: DEFAULT_REQUESTS_PATH,
      rejected: DEFAULT_REJECTED_PATH,
      agents: DEFAULT_AGENTS_PATH,
      flows: DEFAULT_FLOWS_DIR,
      memoryProjects: DEFAULT_MEMORY_PROJECTS_DIR,
      memoryExecution: DEFAULT_MEMORY_EXECUTION_DIR,
      memoryIndex: DEFAULT_MEMORY_INDEX_DIR,
      memorySkills: DEFAULT_MEMORY_SKILLS_DIR,
      memoryPending: DEFAULT_MEMORY_PENDING_DIR,
      memoryTasks: DEFAULT_MEMORY_TASKS_DIR,
      memoryGlobal: DEFAULT_MEMORY_GLOBAL_DIR,
    },
  };

  const result = ConfigSchema.safeParse(minimalConfig);
  if (!result.success) {
    throw new Error(`Parse failed: ${JSON.stringify(result.error.issues, null, 2)}`);
  }
  const parsed = result.data;

  assertEquals(parsed.memory?.auto_approve?.enabled, false);
  assertEquals(parsed.memory?.auto_approve?.confidence_threshold, "high");
  assertEquals(parsed.memory?.auto_approve?.delay_hours, 24);
  assertEquals(parsed.memory?.auto_approve?.sources_allowed, ["AGENT"]);
  assertEquals(parsed.memory?.auto_approve?.max_batch_size, 20);
});

Deno.test("Step 71.1: Config schema allows overriding auto_approve settings", () => {
  const customConfig = {
    agents: { default_model: "gemini-flash" },
    models: { "gemini-flash": { provider: "google", model: "gemini-flash" } },
    system: { root: ".", version: "1.0.0", schema_version: "1.0.0" },
    paths: {
      memory: DEFAULT_MEMORY_PATH,
      blueprints: DEFAULT_BLUEPRINTS_PATH,
      runtime: DEFAULT_RUNTIME_PATH,
      workspace: DEFAULT_WORKSPACE_PATH,
      portals: DEFAULT_PORTALS_PATH,
      active: DEFAULT_ACTIVE_PATH,
      archive: DEFAULT_ARCHIVE_PATH,
      plans: DEFAULT_PLANS_PATH,
      requests: DEFAULT_REQUESTS_PATH,
      rejected: DEFAULT_REJECTED_PATH,
      agents: DEFAULT_AGENTS_PATH,
      flows: DEFAULT_FLOWS_DIR,
      memoryProjects: DEFAULT_MEMORY_PROJECTS_DIR,
      memoryExecution: DEFAULT_MEMORY_EXECUTION_DIR,
      memoryIndex: DEFAULT_MEMORY_INDEX_DIR,
      memorySkills: DEFAULT_MEMORY_SKILLS_DIR,
      memoryPending: DEFAULT_MEMORY_PENDING_DIR,
      memoryTasks: DEFAULT_MEMORY_TASKS_DIR,
      memoryGlobal: DEFAULT_MEMORY_GLOBAL_DIR,
    },
    memory: {
      auto_approve: {
        enabled: true,
        confidence_threshold: "medium",
        delay_hours: 48,
        max_batch_size: 50,
      },
    },
  };

  const result = ConfigSchema.safeParse(customConfig);
  if (!result.success) {
    throw new Error(`Parse failed: ${JSON.stringify(result.error.issues, null, 2)}`);
  }
  const parsed = result.data;

  assertEquals(parsed.memory?.auto_approve?.enabled, true);
  assertEquals(parsed.memory?.auto_approve?.confidence_threshold, "medium");
  assertEquals(parsed.memory?.auto_approve?.delay_hours, 48);
});
