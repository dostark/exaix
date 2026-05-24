/**
 * @module BlueprintIdentityLoadTest
 * @path tests/blueprints/identity_load_test.ts
 * @description Unit tests for loading agent blueprints from the Identities/ directory.
 */

import { assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { AgentExecutor } from "@exaix/execution";

import { ConfigSchema } from "@exaix/schemas/config.ts";
import { createStubConfig, createStubDb, createStubDisplay } from "@exaix/testing";
import { readFixtureTextSync } from "@exaix/testing";

Deno.test("AgentExecutor Blueprint Loading - Mock Identity resolution", async () => {
  const tempDir = await Deno.makeTempDir();
  const identityDir = join(tempDir, "Identities");
  await Deno.mkdir(identityDir);

  const blueprintContent = readFixtureTextSync(
    import.meta.url,
    "blueprints",
    "identity_load_test",
    "blueprintContent.md",
  );
  await Deno.writeTextFile(join(identityDir, "designer.md"), blueprintContent);

  const mockConfig = createStubConfig(ConfigSchema.parse({
    system: { root: tempDir, log_level: "info", schema_version: "1.0.0" },
    paths: { blueprints: tempDir },
    portals: [],
  }));

  const executor = new AgentExecutor(
    mockConfig.get(),
    createStubDb() as AgentExecutor["db"],
    createStubDisplay() as AgentExecutor["logger"],
    {} as AgentExecutor["pathResolver"],
    {} as AgentExecutor["permissions"],
  );

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
  name: "AgentExecutor Blueprint Loading - Path Traversal Prevention",
  sanitizeOps: false,
  fn: async () => {
    const executor = new AgentExecutor(
      createStubConfig(ConfigSchema.parse({
        system: { root: "/tmp", log_level: "info", schema_version: "1.0.0" },
        paths: { blueprints: "/tmp" },
        portals: [],
      })).get(),
      createStubDb() as AgentExecutor["db"],
      createStubDisplay() as AgentExecutor["logger"],
      {} as AgentExecutor["pathResolver"],
      {} as AgentExecutor["permissions"],
    );

    await assertRejects(
      () => executor.loadBlueprint("../../../etc/passwd"),
      Error,
      "Path traversal not allowed", // Message from Zod custom validation
    );

    executor.dispose();
  },
});
