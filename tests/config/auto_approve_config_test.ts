/**
 * @module AutoApproveConfigTest
 * @path tests/config/auto_approve_config_test.ts
 * @description Tests for the [memory.auto_approve] configuration schema and parsing logic.
 */

import { assertEquals } from "@std/assert";
import { ConfigSchema } from "../../src/shared/schemas/config.ts";

Deno.test("Step 71.1: Config schema includes auto_approve block with correct defaults", () => {
  const minimalConfig = {
    agents: { default_model: "gemini-flash" },
    models: { "gemini-flash": { provider: "google", model: "gemini-flash" } },
    system: { root: ".", version: "1.0.0", schema_version: "1.0.0" },
    paths: {
      memory: "Memory",
      blueprints: "Blueprints",
      runtime: ".exa",
      workspace: "Workspace",
      portals: "Portals",
      active: "Active",
      archive: "Archive",
      plans: "Plans",
      requests: "Requests",
      rejected: "Rejected",
      identities: "Identities",
      flows: "Blueprints/Flows",
      memoryProjects: "Memory/Projects",
      memoryExecution: "Memory/Execution",
      memoryIndex: "Memory/Index",
      memorySkills: "Memory/Skills",
      memoryPending: "Memory/Pending",
      memoryTasks: "Memory/Tasks",
      memoryGlobal: "Memory/Global",
    },
  };

  const result = ConfigSchema.safeParse(minimalConfig);
  if (!result.success) {
    throw new Error(`Parse failed: ${JSON.stringify(result.error.issues, null, 2)}`);
  }
  const parsed = result.data;

  // Verify defaults
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
      memory: "Memory",
      blueprints: "Blueprints",
      runtime: ".exa",
      workspace: "Workspace",
      portals: "Portals",
      active: "Active",
      archive: "Archive",
      plans: "Plans",
      requests: "Requests",
      rejected: "Rejected",
      identities: "Identities",
      flows: "Blueprints/Flows",
      memoryProjects: "Memory/Projects",
      memoryExecution: "Memory/Execution",
      memoryIndex: "Memory/Index",
      memorySkills: "Memory/Skills",
      memoryPending: "Memory/Pending",
      memoryTasks: "Memory/Tasks",
      memoryGlobal: "Memory/Global",
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
