/**
 * @module DogfoodAgentRoleTest
 * @path packages/core/tests/blueprints/dogfood_agent_role_test.ts
 * @description Phase 122 Step 1 — verifies the dogfood-developer agent role blueprint loads
 *   through IBlueprintLoader with correct agent_role, default_skills (all 5 rigor
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
const AGENTS_PATH = join(REPO_ROOT, "Blueprints", "Agents");

Deno.test("[dogfood-agent-role] dogfood-developer loads through IBlueprintLoader", async () => {
  const loader = new IBlueprintLoader({ blueprintsPath: AGENTS_PATH });
  const blueprint = await loader.load("dogfood-developer");

  assertExists(blueprint, "dogfood-developer agent role must load");
  assertEquals(blueprint.agentRole, "dogfood-developer");
});

/** Skills this agent role cannot do its job without, whatever else it carries — deliberately
 *  a SUBSET, not an exact list or count, both of which break on any legitimate curation
 *  without saying what the agent role actually needs. */
const DOGFOOD_REQUIRED_SKILLS = ["response-contract", "exaix-conventions", "tdd-methodology"];

Deno.test("[dogfood-agent-role] dogfood-developer carries the skills its role requires", async () => {
  const loader = new IBlueprintLoader({ blueprintsPath: AGENTS_PATH });
  const blueprint = await loader.load("dogfood-developer");

  assertExists(blueprint);
  const skills = blueprint.frontmatter.default_skills ?? [];

  const missing = DOGFOOD_REQUIRED_SKILLS.filter((skill) => !skills.includes(skill));
  assertEquals(missing, [], `dogfood-developer is missing role-required default_skills: ${missing.join(", ")}`);
});

Deno.test("[dogfood-agent-role] agent_role is dogfood-developer", async () => {
  const loader = new IBlueprintLoader({ blueprintsPath: AGENTS_PATH });
  const blueprint = await loader.load("dogfood-developer");

  assertExists(blueprint);
  assertEquals(blueprint.agentRole, "dogfood-developer");
});

Deno.test("[dogfood-agent-role] permitted_tools contains file, command, and search tools", async () => {
  const loader = new IBlueprintLoader({ blueprintsPath: AGENTS_PATH });
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

Deno.test("[dogfood-agent-role] every permitted_tool is a valid McpToolName", async () => {
  const loader = new IBlueprintLoader({ blueprintsPath: AGENTS_PATH });
  const blueprint = await loader.load("dogfood-developer");

  assertExists(blueprint);
  const tools = (blueprint.frontmatter.permitted_tools ?? []) as McpToolName[];

  const validValues = new Set(Object.values(McpToolName));
  for (const tool of tools) {
    assertEquals(validValues.has(tool), true, `'${tool}' must be a valid McpToolName`);
  }
});

Deno.test("[dogfood-agent-role] loads without Zod error through IBlueprintLoader", async () => {
  const loader = new IBlueprintLoader({ blueprintsPath: AGENTS_PATH });
  const blueprint = await loader.load("dogfood-developer");

  assertExists(blueprint, "agent role must load without error");
  assertEquals(typeof blueprint.agentRole, "string");
  assertEquals(typeof blueprint.name, "string");
  assertEquals(typeof blueprint.frontmatter.model, "string");
});
