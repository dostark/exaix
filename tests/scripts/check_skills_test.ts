/**
 * @module CheckSkillsTest
 * @path tests/scripts/check_skills_test.ts
 * @description Phase 206 Step 3 — the retained `check:skill-index` gate validates skill
 *   folders through the production loader: the repository catalog passes with exactly 27
 *   folders, and invalid folders, legacy JSON, flat skill files and executable content fail
 *   with typed reasons.
 * @architectural-layer Test
 * @dependencies [@std/assert, @exaix/testing, scripts/check_skills.ts]
 * @related-files [scripts/check_skills.ts]
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { REPO_ROOT } from "@exaix/testing";
import { checkSkillCatalog } from "../../scripts/check_skills.ts";

const CATALOG_SIZE = 27;

async function withRepo(fn: (root: string) => Promise<void>): Promise<void> {
  const root = await Deno.makeTempDir({ prefix: "exa-check-skills-" });
  try {
    await Deno.mkdir(join(root, "Blueprints", "Skills", "good-skill"), { recursive: true });
    await Deno.writeTextFile(
      join(root, "Blueprints", "Skills", "good-skill", "SKILL.md"),
      "---\nname: good-skill\ndescription: A valid skill\n---\nBody.\n",
    );
    await fn(root);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
}

Deno.test("[check-skills] the repository catalog passes with exactly 27 skill folders", async () => {
  const result = await checkSkillCatalog(REPO_ROOT);
  assertEquals(result.errors, []);
  assertEquals(result.ok, true);
  assertEquals(result.skillCount, CATALOG_SIZE);
});

Deno.test("[check-skills] a valid minimal folder passes", async () => {
  await withRepo(async (root) => {
    const result = await checkSkillCatalog(root);
    assertEquals(result, { ok: true, skillCount: 1, errors: [] });
  });
});

Deno.test("[check-skills] an invalid folder, legacy JSON, a flat skill file and scripts fail with typed reasons", async () => {
  await withRepo(async (root) => {
    const skills = join(root, "Blueprints", "Skills");
    await Deno.mkdir(join(skills, "broken-skill"));
    await Deno.writeTextFile(join(skills, "broken-skill", "SKILL.md"), "no frontmatter");
    await Deno.writeTextFile(join(skills, "legacy.json"), "{}");
    await Deno.writeTextFile(join(skills, "flat.skill.md"), "flat");
    await Deno.mkdir(join(skills, "good-skill", "scripts"));
    const result = await checkSkillCatalog(root);
    assertEquals(result.ok, false);
    assertEquals(result.errors.sort(), [
      "Blueprints/Skills/broken-skill: invalid_frontmatter",
      "Blueprints/Skills/flat.skill.md: legacy_layout",
      "Blueprints/Skills/good-skill: executable_content",
      "Blueprints/Skills/legacy.json: legacy_layout",
    ]);
  });
});

Deno.test("[check-skills] project roots are validated per portal", async () => {
  await withRepo(async (root) => {
    const portal = join(root, "Memory", "Skills", "project", "Alpha", "proj-skill");
    await Deno.mkdir(portal, { recursive: true });
    await Deno.writeTextFile(join(portal, "SKILL.md"), "---\nname: other-name\ndescription: Mismatch\n---\nx\n");
    const result = await checkSkillCatalog(root);
    assertEquals(result.errors, ["Memory/Skills/project/Alpha/proj-skill: invalid_frontmatter"]);
  });
});

Deno.test("[check-skills] a missing Blueprint root is a warning, not an error", async () => {
  const root = await Deno.makeTempDir({ prefix: "exa-check-skills-empty-" });
  try {
    assertEquals((await checkSkillCatalog(root)).ok, true);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
