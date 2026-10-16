/**
 * @module EmbeddingConfigTest
 * @path packages/schemas/tests/embedding_config_test.ts
 * @description Tests for [memory.embedding] config schema — validates that
 *   the new embedding model/dimension fields parse correctly and default.
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

function minimalConfig() {
  return {
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
}

Deno.test("Step 68.4: memory.embedding is undefined when not provided", () => {
  const result = ConfigSchema.safeParse(minimalConfig());
  if (!result.success) {
    throw new Error(`Parse failed: ${JSON.stringify(result.error.issues, null, 2)}`);
  }
  const parsed = result.data;

  assertEquals(parsed.memory?.embedding, undefined);
});

Deno.test("Step 68.4: memory.embedding defaults fill in when empty object provided", () => {
  const config = {
    ...minimalConfig(),
    memory: {
      embedding: {},
    },
  };

  const result = ConfigSchema.safeParse(config);
  if (!result.success) {
    throw new Error(`Parse failed: ${JSON.stringify(result.error.issues, null, 2)}`);
  }
  const parsed = result.data;

  assertEquals(parsed.memory?.embedding?.model, "nomic-embed-text");
  assertEquals(parsed.memory?.embedding?.dimension, 768);
});

Deno.test("Step 68.4: Config schema allows overriding memory.embedding settings", () => {
  const customConfig = {
    ...minimalConfig(),
    memory: {
      embedding: {
        model: "all-MiniLM-L6-v2",
        dimension: 384,
      },
    },
  };

  const result = ConfigSchema.safeParse(customConfig);
  if (!result.success) {
    throw new Error(`Parse failed: ${JSON.stringify(result.error.issues, null, 2)}`);
  }
  const parsed = result.data;

  assertEquals(parsed.memory?.embedding?.model, "all-MiniLM-L6-v2");
  assertEquals(parsed.memory?.embedding?.dimension, 384);
});
