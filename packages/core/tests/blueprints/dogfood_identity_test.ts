/**
 * @module DogfoodIdentityTest
 * @path packages/core/tests/blueprints/dogfood_identity_test.ts
 * @description Phase 122 Step 1 — verifies the dogfood-coder identity blueprint loads
 *   through BlueprintLoader with correct identity_id, default_skills (all 5 rigor
 *   skills), and valid McpToolName entries in permitted_tools.
 * @architectural-layer Integration
 * @dependencies [@exaix/core, @std/path]
 * @related-files [packages/core/src/blueprint/blueprint_loader.ts]
 */

import { assertEquals, assertExists } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { BlueprintLoader } from "@exaix/core/blueprint";
import { McpToolName } from "@exaix/core/types";

const REPO_ROOT = fromFileUrl(new URL("../../../../", import.meta.url));
const IDENTITIES_PATH = join(REPO_ROOT, "Blueprints", "Identities");

Deno.test("[dogfood-identity] dogfood-coder loads through BlueprintLoader", async () => {
  const loader = new BlueprintLoader({ blueprintsPath: IDENTITIES_PATH });
  const blueprint = await loader.load("dogfood-coder");

  assertExists(blueprint, "dogfood-coder identity must load");
  assertEquals(blueprint.identityId, "dogfood-coder");
});

Deno.test("[dogfood-identity] dogfood-coder has all 5 default_skills", async () => {
  const loader = new BlueprintLoader({ blueprintsPath: IDENTITIES_PATH });
  const blueprint = await loader.load("dogfood-coder");

  assertExists(blueprint);
  const skills = blueprint.frontmatter.default_skills ?? [];
  const rigorSkills = ["tdd-methodology", "exaix-conventions", "portal-grounding", "security-first", "code-review"];

  for (const skill of rigorSkills) {
    assertEquals(skills.includes(skill), true, `default_skills must include '${skill}'`);
  }
  assertEquals(skills.length, 5, "must have exactly 5 rigor skills");
});

Deno.test("[dogfood-identity] identity_id is dogfood-coder", async () => {
  const loader = new BlueprintLoader({ blueprintsPath: IDENTITIES_PATH });
  const blueprint = await loader.load("dogfood-coder");

  assertExists(blueprint);
  assertEquals(blueprint.identityId, "dogfood-coder");
});

Deno.test("[dogfood-identity] permitted_tools contains file, command, and search tools", async () => {
  const loader = new BlueprintLoader({ blueprintsPath: IDENTITIES_PATH });
  const blueprint = await loader.load("dogfood-coder");

  assertExists(blueprint);
  const tools = (blueprint.frontmatter.permitted_tools ?? []) as McpToolName[];

  const expectedTools: McpToolName[] = [
    McpToolName.READ_FILE,
    McpToolName.WRITE_FILE,
    McpToolName.PATCH_FILE,
    McpToolName.SEARCH_FILES,
    McpToolName.RUN_COMMAND,
    McpToolName.LIST_DIRECTORY,
    McpToolName.CREATE_DIRECTORY,
  ];
  for (const tool of expectedTools) {
    assertEquals(tools.includes(tool), true, `permitted_tools must include '${tool}'`);
  }
});

Deno.test("[dogfood-identity] every permitted_tool is a valid McpToolName", async () => {
  const loader = new BlueprintLoader({ blueprintsPath: IDENTITIES_PATH });
  const blueprint = await loader.load("dogfood-coder");

  assertExists(blueprint);
  const tools = (blueprint.frontmatter.permitted_tools ?? []) as McpToolName[];

  const validValues = new Set(Object.values(McpToolName));
  for (const tool of tools) {
    assertEquals(validValues.has(tool), true, `'${tool}' must be a valid McpToolName`);
  }
});

Deno.test("[dogfood-identity] loads without Zod error through BlueprintLoader", async () => {
  const loader = new BlueprintLoader({ blueprintsPath: IDENTITIES_PATH });
  const blueprint = await loader.load("dogfood-coder");

  assertExists(blueprint, "identity must load without error");
  assertEquals(typeof blueprint.identityId, "string");
  assertEquals(typeof blueprint.name, "string");
  assertEquals(typeof blueprint.frontmatter.model, "string");
});
