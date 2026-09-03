/**
 * @module RequestCommandsSkillsTest
 * @path apps/exactl/tests/request_commands_skills_test.ts
 * @related-files []
 * @architectural-layer CLI
 * @description Verifies the CLI implementation of dynamic skills injection during request creation,
 * ensuring additional capabilities are correctly persisted in the request frontmatter.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { parse as parseYaml } from "@std/yaml";
import { RequestCommands } from "../src/commands/request_commands.ts";
import { createCliTestContext } from "./helpers/test_setup.ts";
import type { JSONObject } from "@exaix/core/types";

Deno.test("RequestCommands - Dynamic Skills Injection", async (t) => {
  const { tempDir, cleanup, context } = await createCliTestContext();
  const requestCommands = new RequestCommands(context);

  await t.step("create request with explicit skills", async () => {
    // 1. Create request with skills
    const metadata = await requestCommands.create("Test request with skills", {
      agent_role: "security-expert",
      skills: ["documentation-driven", "file-ops"],
    });

    // 2. Verify file exists
    const requestPath = join(tempDir, "Workspace/Requests", metadata.filename);
    const content = await Deno.readTextFile(requestPath);

    // 3. Parse frontmatter
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    if (!match) throw new Error("No frontmatter found");

    const frontmatter = parseYaml(match[1]) as JSONObject;

    // 4. Assert skills are present and correct type (YAML parser deserializes JSON string to array)
    assertEquals(frontmatter.skills, ["documentation-driven", "file-ops"]);
    assertStringIncludes(content, "skills:");
  });

  await t.step("create request with single skill", async () => {
    // 1. Create request with single skill
    const metadata = await requestCommands.create("Test request with single skill", {
      agent_role: "security-expert",
      skills: ["code-review"],
    });

    // 2. Verify frontmatter
    const requestPath = join(tempDir, "Workspace/Requests", metadata.filename);
    const content = await Deno.readTextFile(requestPath);
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    if (!match) throw new Error("No frontmatter found");
    const frontmatter = parseYaml(match[1]) as JSONObject;

    assertEquals(frontmatter.skills, ["code-review"]);
  });

  await t.step("create request without skills", async () => {
    // 1. Create request without skills
    const metadata = await requestCommands.create("Test request without skills", {
      agent_role: "security-expert",
    });

    // 2. Verify frontmatter does NOT have skills
    const requestPath = join(tempDir, "Workspace/Requests", metadata.filename);
    const content = await Deno.readTextFile(requestPath);
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    if (!match) throw new Error("No frontmatter found");
    const frontmatter = parseYaml(match[1]) as JSONObject;

    assertEquals(frontmatter.skills, undefined);
  });

  await cleanup();
});
