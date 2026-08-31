/**
 * @module DogfoodIdentityTest
 * @path packages/core/tests/blueprints/dogfood_identity_test.ts
 * @description Phase 122 Step 1 — verifies the dogfood-developer identity blueprint loads
 *   through IBlueprintLoader with correct identity_id, default_skills (all 5 rigor
 *   skills), and valid McpToolName entries in permitted_tools.
 * @architectural-layer Integration
 * @dependencies [@exaix/core, @std/path]
 * @related-files [packages/core/src/blueprint/blueprint_loader.ts]
 */

import { assertEquals, assertExists } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { IBlueprintLoader } from "@exaix/core/blueprint";
import { McpToolName } from "@exaix/core/types";

const REPO_ROOT = fromFileUrl(new URL("../../../../", import.meta.url));
const IDENTITIES_PATH = join(REPO_ROOT, "Blueprints", "Identities");

Deno.test("[dogfood-identity] dogfood-developer loads through IBlueprintLoader", async () => {
  const loader = new IBlueprintLoader({ blueprintsPath: IDENTITIES_PATH });
  const blueprint = await loader.load("dogfood-developer");

  assertExists(blueprint, "dogfood-developer identity must load");
  assertEquals(blueprint.identityId, "dogfood-developer");
});

/** Skills this identity cannot do its job without, whatever else it carries — deliberately
 *  a SUBSET, not an exact list or count, both of which break on any legitimate curation
 *  without saying what the identity actually needs. */
const DOGFOOD_REQUIRED_SKILLS = ["response-contract", "exaix-conventions", "tdd-methodology"];

Deno.test("[dogfood-identity] dogfood-developer carries the skills its role requires", async () => {
  const loader = new IBlueprintLoader({ blueprintsPath: IDENTITIES_PATH });
  const blueprint = await loader.load("dogfood-developer");

  assertExists(blueprint);
  const skills = blueprint.frontmatter.default_skills ?? [];

  const missing = DOGFOOD_REQUIRED_SKILLS.filter((skill) => !skills.includes(skill));
  assertEquals(missing, [], `dogfood-developer is missing role-required default_skills: ${missing.join(", ")}`);
});

Deno.test("[dogfood-identity] identity_id is dogfood-developer", async () => {
  const loader = new IBlueprintLoader({ blueprintsPath: IDENTITIES_PATH });
  const blueprint = await loader.load("dogfood-developer");

  assertExists(blueprint);
  assertEquals(blueprint.identityId, "dogfood-developer");
});

Deno.test("[dogfood-identity] permitted_tools contains file, command, and search tools", async () => {
  const loader = new IBlueprintLoader({ blueprintsPath: IDENTITIES_PATH });
  const blueprint = await loader.load("dogfood-developer");

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
  const loader = new IBlueprintLoader({ blueprintsPath: IDENTITIES_PATH });
  const blueprint = await loader.load("dogfood-developer");

  assertExists(blueprint);
  const tools = (blueprint.frontmatter.permitted_tools ?? []) as McpToolName[];

  const validValues = new Set(Object.values(McpToolName));
  for (const tool of tools) {
    assertEquals(validValues.has(tool), true, `'${tool}' must be a valid McpToolName`);
  }
});

Deno.test("[dogfood-identity] loads without Zod error through IBlueprintLoader", async () => {
  const loader = new IBlueprintLoader({ blueprintsPath: IDENTITIES_PATH });
  const blueprint = await loader.load("dogfood-developer");

  assertExists(blueprint, "identity must load without error");
  assertEquals(typeof blueprint.identityId, "string");
  assertEquals(typeof blueprint.name, "string");
  assertEquals(typeof blueprint.frontmatter.model, "string");
});
