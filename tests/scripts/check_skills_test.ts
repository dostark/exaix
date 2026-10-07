/**
 * @module CheckSkillsTest
 * @path tests/scripts/check_skills_test.ts
 * @description Phase 206 Step 3 — the retained `check:skill-index` gate validates skill
 *   folders through the production loader: the repository catalog passes with its 27 Blueprint and
 *   project folders plus the 28 dogfood folders, and invalid folders, legacy JSON, flat skill files and executable content fail
 *   with typed reasons.
 * @architectural-layer Test
 * @dependencies [@std/assert, @exaix/testing, scripts/check_skills.ts]
 * @related-files [scripts/check_skills.ts]
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { REPO_ROOT } from "@exaix/testing";
import { checkSkillCatalog, REPOSITORY_EXPECTED_COUNTS } from "../../scripts/check_skills.ts";

const CATALOG_SIZE = 27 + 28;
const NO_COUNTS = undefined;

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

Deno.test("[check-skills] the repository catalog passes with all Blueprint, project and dogfood folders", async () => {
  const result = await checkSkillCatalog(REPO_ROOT, REPOSITORY_EXPECTED_COUNTS);
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

Deno.test("[check-skills] the tracked Exaix project root is validated", async () => {
  await withRepo(async (root) => {
    const portal = join(root, "Memory", "Skills", "project", "Exaix", "proj-skill");
    await Deno.mkdir(portal, { recursive: true });
    await Deno.writeTextFile(join(portal, "SKILL.md"), "---\nname: other-name\ndescription: Mismatch\n---\nx\n");
    const result = await checkSkillCatalog(root);
    assertEquals(result.errors, ["Memory/Skills/project/Exaix/proj-skill: invalid_frontmatter"]);
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

Deno.test("[check-skills] a dogfood folder with an invalid sidecar is reported under .copilot/skills", async () => {
  await withRepo(async (root) => {
    const dogfood = join(root, ".copilot", "skills", "dev-skill");
    await Deno.mkdir(dogfood, { recursive: true });
    await Deno.writeTextFile(
      join(dogfood, "SKILL.md"),
      "---\nname: dev-skill\ndescription: Dev skill\nscope: dev\n---\nx\n",
    );
    await Deno.writeTextFile(join(dogfood, "exaix.yaml"), "unknown_field: true\n");
    const result = await checkSkillCatalog(root);
    assertEquals(result.errors, [".copilot/skills/dev-skill: invalid_sidecar"]);
  });
});

Deno.test("[check-skills] a required corpus with the wrong or zero count fails with the expected and found counts", async () => {
  await withRepo(async (root) => {
    const result = await checkSkillCatalog(root, { catalog: 27, dogfood: 28 });
    assertEquals(result.ok, false);
    assertEquals(result.errors, [
      "Blueprint and project skills: expected 27 folders, found 1",
      ".copilot/skills: expected 28 folders, found 0",
    ]);
  });
});

Deno.test("[check-skills] learned roots, operator portal roots and developer config never affect the gate", async () => {
  await withRepo(async (root) => {
    const learned = join(root, "Memory", "Skills", "learned", "operator-draft");
    await Deno.mkdir(learned, { recursive: true });
    await Deno.writeTextFile(join(learned, "SKILL.md"), "not valid at all");
    const operator = join(root, "Memory", "Skills", "project", "Local", "scratch");
    await Deno.mkdir(operator, { recursive: true });
    await Deno.writeTextFile(join(operator, "SKILL.md"), "not valid either");
    const config = join(root, "developer.toml");
    await Deno.writeTextFile(config, '[skills]\nroots = [{ kind = "learned", path = "/nonexistent" }]\n');
    const previous = Deno.env.get("EXA_CONFIG_PATH");
    Deno.env.set("EXA_CONFIG_PATH", config);
    try {
      assertEquals(await checkSkillCatalog(root, NO_COUNTS), { ok: true, skillCount: 1, errors: [] });
    } finally {
      if (previous === undefined) Deno.env.delete("EXA_CONFIG_PATH");
      else Deno.env.set("EXA_CONFIG_PATH", previous);
    }
  });
});
