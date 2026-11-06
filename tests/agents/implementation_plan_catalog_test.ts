/**
 * @module ImplementationPlanCatalogTest
 * @path tests/agents/implementation_plan_catalog_test.ts
 * @description Checks the shipped architect default and its resolvable Blueprint planning revision.
 * @architectural-layer Test
 * @related-files [packages/core/src/blueprint/blueprint_loader.ts, scripts/skill_catalog_loader.ts]
 */
import { assertEquals, assertExists, assertMatch } from "@std/assert";
import { join } from "@std/path";
import { createBlueprintLoader } from "@exaix/core/blueprint";
import { SkillRootKind, SkillStatus } from "@exaix/core";
import { REPO_ROOT } from "@exaix/testing";
import { CATALOG_CONTEXT, createCatalogLoader } from "../../scripts/skill_catalog_loader.ts";

Deno.test("the architect loads a response contract without global implementation-planning instructions", async () => {
  const loader = createBlueprintLoader(join(REPO_ROOT, "Blueprints"));
  const architect = await loader.load("software-architect");
  assertExists(architect);
  assertEquals(loader.toLegacyBlueprint(architect).defaultSkills, [
    "response-contract",
    "architecture-review",
    "collaborative-flow",
  ]);
  assertEquals(architect.frontmatter.permitted_tools, [
    "read_file",
    "list_directory",
    "search_text",
    "fetch_url",
    "git_info",
    "move_file",
    "run_deno_task",
  ]);
});

Deno.test("the architect planning skill resolves to an active Blueprint revision", async () => {
  const loader = createCatalogLoader(join(REPO_ROOT, "Blueprints", "Skills"));
  const skills = await loader.listAll(CATALOG_CONTEXT);
  const planning = skills.find((entry) => entry.skill.name === "implementation-plan");
  assertExists(planning);
  assertEquals(planning.skill.status, SkillStatus.ACTIVE);
  assertEquals(planning.skill.root_kind, SkillRootKind.BLUEPRINT);
  assertMatch(planning.skill.content_sha256, /^[a-f0-9]{64}$/);
  assertEquals(await loader.diagnostics(CATALOG_CONTEXT), []);
});
