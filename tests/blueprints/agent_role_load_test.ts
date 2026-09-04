/**
 * @module BlueprintAgentRoleLoadTest
 * @path tests/blueprints/agent_role_load_test.ts
 * @description Unit tests for loading agent blueprints from the Blueprints/Agents/ directory.
 */

import { assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { AgentComposer } from "@exaix/execution";

import { ConfigSchema } from "@exaix/schemas/config.ts";
import { createStubConfig, createStubDb, createStubDisplay } from "@exaix/testing";
import { readFixtureTextSync } from "@exaix/testing";

Deno.test("AgentComposer Blueprint Loading - Mock Agent Role resolution", async () => {
  const tempDir = await Deno.makeTempDir();
  const agentRoleDir = join(tempDir, "Agents");
  await Deno.mkdir(agentRoleDir);

  const blueprintContent = readFixtureTextSync(
    import.meta.url,
    "blueprints",
    "agent_role_load_test",
    "blueprintContent.md",
  );
  await Deno.writeTextFile(join(agentRoleDir, "designer.md"), blueprintContent);

  const mockConfig = createStubConfig(ConfigSchema.parse({
    system: { root: tempDir, log_level: "info", schema_version: "1.0.0" },
    paths: { blueprints: tempDir },
    portals: [],
  }));

  const executor = new AgentComposer({
    config: mockConfig.get(),
    db: createStubDb() as AgentComposer["db"],
    logger: createStubDisplay() as AgentComposer["logger"],
    pathResolver: {} as AgentComposer["pathResolver"],
    permissions: {} as AgentComposer["permissions"],
  });

  try {
    const blueprint = await executor.loadBlueprint("designer");

    assertEquals(blueprint.name, "designer");
    assertEquals(blueprint.model, "gpt-4");
    assertEquals(blueprint.provider, "openai");
    assertEquals(blueprint.capabilities, ["design"]);
    assertEquals(blueprint.systemPrompt, "You are a lead UI/UX designer.");
  } finally {
    executor.dispose();
  }

  // Clean up
  await Deno.remove(tempDir, { recursive: true });
});

Deno.test({
  name: "AgentComposer Blueprint Loading - Path Traversal Prevention",
  sanitizeOps: false,
  fn: async () => {
    const executor = new AgentComposer({
      config: createStubConfig(ConfigSchema.parse({
        system: { root: "/tmp", log_level: "info", schema_version: "1.0.0" },
        paths: { blueprints: "/tmp" },
        portals: [],
      })).get(),
      db: createStubDb() as AgentComposer["db"],
      logger: createStubDisplay() as AgentComposer["logger"],
      pathResolver: {} as AgentComposer["pathResolver"],
      permissions: {} as AgentComposer["permissions"],
    });

    await assertRejects(
      () => executor.loadBlueprint("../../../etc/passwd"),
      Error,
      "Path traversal not allowed", // Message from Zod custom validation
    );

    executor.dispose();
  },
});
