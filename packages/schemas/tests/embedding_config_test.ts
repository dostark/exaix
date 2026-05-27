/**
 * @module EmbeddingConfigTest
 * @path packages/schemas/tests/embedding_config_test.ts
 * @description Tests for [memory.embedding] config schema — validates that
 *   the new embedding model/dimension fields parse correctly and default.
 */
import { assertEquals } from "@std/assert";
import { ConfigSchema } from "@exaix/schemas";

function minimalConfig() {
  return {
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
