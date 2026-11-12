/**
 * @module CheckSkillsTest
 * @path tests/scripts/check_skills_test.ts
 * @description Phase 206 Step 3 — the retained `check:skill-index` gate validates skill
 *   folders through the production loader and compares each root's folder set with the
 *   checked-in membership lock. Invalid folders, legacy JSON, flat skill files and executable
 *   content fail with typed reasons; an added or removed folder fails with its name.
 * @architectural-layer Test
 * @dependencies [@std/assert, @exaix/testing, scripts/check_skills.ts]
 * @related-files [scripts/check_skills.ts]
 */

import * as pathBuilders from "@exaix/shared";
import { DEFAULT_BLUEPRINTS_PATH, DEFAULT_MEMORY_PATH, DEFAULT_SKILLS_MEMORY_PATH } from "@exaix/shared";
import { assert, assertArrayIncludes, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { REPO_ROOT, withTempDir } from "@exaix/testing";
import {
  buildSkillCatalogSnapshot,
  checkSkillCatalog,
  type ISkillCatalogLock,
  loadSkillCatalogLock,
  writeSkillCatalogLock,
} from "../../scripts/check_skills.ts";

/** Every tracked root, in the order the lock records them. */
const ROOTS = ["Blueprints/Skills", ".copilot/skills", "Memory/Skills/project/Exaix"] as const;

function emptyLock(roots: ISkillCatalogLock["roots"] = {}): ISkillCatalogLock {
  return {
    version: "1",
    roots: {
      "Blueprints/Skills": [],
      ".copilot/skills": [],
      "Memory/Skills/project/Exaix": [],
      ...roots,
    },
  };
}

async function withRepo(fn: (root: string) => Promise<void>): Promise<void> {
  await withTempDir(async (root) => {
    await Deno.mkdir(pathBuilders.blueprintsPath(root, DEFAULT_SKILLS_MEMORY_PATH, "good-skill"), {
      recursive: true,
    });
    await Deno.writeTextFile(
      pathBuilders.blueprintsPath(root, DEFAULT_SKILLS_MEMORY_PATH, "good-skill", "SKILL.md"),
      "---\nname: good-skill\ndescription: A valid skill\n---\nBody.\n",
    );
    await fn(root);
  }, { prefix: "exa-check-skills-" });
}

Deno.test("[check-skills] the repository corpus matches the checked-in membership lock", async () => {
  const lock = await loadSkillCatalogLock(REPO_ROOT);
  const result = await checkSkillCatalog(REPO_ROOT, lock);
  assertEquals(result.errors, []);
  assertEquals(result.ok, true);
  assertArrayIncludes(lock.roots["Blueprints/Skills"], ["architecture-review"]);
  assertArrayIncludes(lock.roots[".copilot/skills"], ["refactor"]);
  assertArrayIncludes(lock.roots["Memory/Skills/project/Exaix"], ["portal-grounding"]);
});

Deno.test("[check-skills] the snapshot lists sorted folder names for every tracked root", async () => {
  await withRepo(async (root) => {
    const snapshot = await buildSkillCatalogSnapshot(root);
    assertEquals(snapshot.errors, []);
    assertEquals(snapshot.roots["Blueprints/Skills"], ["good-skill"]);
    assertEquals(snapshot.roots[".copilot/skills"], []);
    assertEquals(snapshot.roots["Memory/Skills/project/Exaix"], []);
    assertEquals(Object.keys(snapshot.roots).sort(), [...ROOTS].sort());
  });
});

Deno.test("[check-skills] a folder absent from the lock fails with its name", async () => {
  await withRepo(async (root) => {
    const result = await checkSkillCatalog(root, emptyLock());
    assertEquals(result.ok, false);
    assertEquals(result.errors, ["Blueprints/Skills: added good-skill"]);
  });
});

Deno.test("[check-skills] a lock entry with no folder fails with its name", async () => {
  await withRepo(async (root) => {
    const result = await checkSkillCatalog(root, emptyLock({ "Blueprints/Skills": ["good-skill", "stale-skill"] }));
    assertEquals(result.ok, false);
    assertEquals(result.errors, ["Blueprints/Skills: removed stale-skill"]);
  });
});

Deno.test("[check-skills] the lock round-trips through write and load", async () => {
  await withRepo(async (root) => {
    const snapshot = await buildSkillCatalogSnapshot(root);
    await writeSkillCatalogLock(root, snapshot);
    const loaded = await loadSkillCatalogLock(root);
    assertEquals(loaded.version, "1");
    assertEquals(loaded.roots["Blueprints/Skills"], ["good-skill"]);
    assertEquals((await checkSkillCatalog(root, loaded)).errors, []);
  });
});

Deno.test("[check-skills] a missing lock file is an error that names the update command", async () => {
  await withRepo(async (root) => {
    const lock = await loadSkillCatalogLock(root).catch((error: Error) => error);
    assert(lock instanceof Error);
    assertStringIncludes(lock.message, "--update");
  });
});

Deno.test("[check-skills] a valid minimal folder passes", async () => {
  await withRepo(async (root) => {
    const result = await checkSkillCatalog(root);
    assertEquals(result, { ok: true, skillCount: 1, errors: [] });
  });
});

Deno.test("[check-skills] an invalid folder, legacy JSON, a flat skill file and scripts fail with typed reasons", async () => {
  await withRepo(async (root) => {
    const skills = pathBuilders.blueprintsPath(root, DEFAULT_SKILLS_MEMORY_PATH);
    await Deno.mkdir(join(skills, "broken-skill"));
    await Deno.writeTextFile(join(skills, "broken-skill", "SKILL.md"), "no frontmatter");
    await Deno.writeTextFile(join(skills, "legacy.json"), "{}");
    await Deno.writeTextFile(join(skills, "flat.skill.md"), "flat");
    await Deno.mkdir(join(skills, "good-skill", "scripts"));
    const result = await checkSkillCatalog(root);
    assertEquals(result.ok, false);
    assertEquals(result.errors.sort(), [
      `${DEFAULT_BLUEPRINTS_PATH}/${DEFAULT_SKILLS_MEMORY_PATH}/broken-skill: invalid_frontmatter`,
      `${DEFAULT_BLUEPRINTS_PATH}/${DEFAULT_SKILLS_MEMORY_PATH}/flat.skill.md: legacy_layout`,
      `${DEFAULT_BLUEPRINTS_PATH}/${DEFAULT_SKILLS_MEMORY_PATH}/good-skill: executable_content`,
      `${DEFAULT_BLUEPRINTS_PATH}/${DEFAULT_SKILLS_MEMORY_PATH}/legacy.json: legacy_layout`,
    ]);
  });
});

Deno.test("[check-skills] the tracked Exaix project root is validated", async () => {
  await withRepo(async (root) => {
    const portal = pathBuilders.memoryPath(root, DEFAULT_SKILLS_MEMORY_PATH, "project", "Exaix", "proj-skill");
    await Deno.mkdir(portal, { recursive: true });
    await Deno.writeTextFile(join(portal, "SKILL.md"), "---\nname: other-name\ndescription: Mismatch\n---\nx\n");
    const result = await checkSkillCatalog(root);
    assertEquals(result.errors, [
      `${DEFAULT_MEMORY_PATH}/${DEFAULT_SKILLS_MEMORY_PATH}/project/Exaix/proj-skill: invalid_frontmatter`,
    ]);
  });
});

Deno.test("[check-skills] a missing Blueprint root is a warning, not an error", async () => {
  await withTempDir(async (root) => {
    assertEquals((await checkSkillCatalog(root)).ok, true);
  }, { prefix: "exa-check-skills-empty-" });
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

Deno.test("[check-skills] learned roots, operator portal roots and developer config never affect the gate", async () => {
  await withRepo(async (root) => {
    const learned = pathBuilders.memoryPath(root, DEFAULT_SKILLS_MEMORY_PATH, "learned", "operator-draft");
    await Deno.mkdir(learned, { recursive: true });
    await Deno.writeTextFile(join(learned, "SKILL.md"), "not valid at all");
    const operator = pathBuilders.memoryPath(root, DEFAULT_SKILLS_MEMORY_PATH, "project", "Local", "scratch");
    await Deno.mkdir(operator, { recursive: true });
    await Deno.writeTextFile(join(operator, "SKILL.md"), "not valid either");
    const config = join(root, "developer.toml");
    await Deno.writeTextFile(config, '[skills]\nroots = [{ kind = "learned", path = "/nonexistent" }]\n');
    const previous = Deno.env.get("EXA_CONFIG_PATH");
    Deno.env.set("EXA_CONFIG_PATH", config);
    try {
      assertEquals(await checkSkillCatalog(root), { ok: true, skillCount: 1, errors: [] });
    } finally {
      if (previous === undefined) Deno.env.delete("EXA_CONFIG_PATH");
      else Deno.env.set("EXA_CONFIG_PATH", previous);
    }
  });
});
