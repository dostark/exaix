/**
 * @module BlueprintIdentityLoadTest
 * @path tests/blueprints/identity_load_test.ts
 * @description Unit tests for loading agent blueprints from the Identities/ directory.
 */

import { assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { AgentExecutor } from "../../src/services/agent/agent_executor.ts";
import { Config } from "../../src/shared/schemas/config.ts";

Deno.test("AgentExecutor Blueprint Loading - Mock Identity resolution", async () => {
  const tempDir = await Deno.makeTempDir();
  const identityDir = join(tempDir, "Identities");
  await Deno.mkdir(identityDir);

  const blueprintContent = `---
name: designer
model: gpt-4
provider: openai
capabilities: ["design"]
---
You are a lead UI/UX designer.
`;

  await Deno.writeTextFile(join(identityDir, "designer.md"), blueprintContent);

  const mockConfig: Partial<Config> = {
    paths: { blueprints: tempDir } as any,
    portals: [],
  };

  const executor = new AgentExecutor(
    mockConfig as Config,
    {} as any,
    { info: () => {} } as any, // Simple mock logger
    {} as any,
    {} as any,
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
      { paths: { blueprints: "/tmp" } } as any,
      {} as any,
      { error: () => {} } as any,
      {} as any,
      {} as any,
    );

    await assertRejects(
      () => executor.loadBlueprint("../../../etc/passwd"),
      Error,
      "Path traversal not allowed", // Message from Zod custom validation
    );

    executor.dispose();
  },
});
