/**
 * @module BuildSkillsIndexTest
 * @path tests/scripts/build_skills_index_test.ts
 * @description Tests for scripts/build_skills_index.ts — the generator that turns
 *   Blueprints/Skills/*.skill.md (full SkillSchema frontmatter + markdown body)
 *   into loadable Memory/Skills/<scope>/<skill_id>.json files. Covers schema
 *   validity, per-skill scope routing (GAP-4: global vs project/<project>/), and
 *   --check no-drift detection.
 * @architectural-layer Script (test)
 * @dependencies [@std/assert, @std/fs, @std/path]
 * @related-files [scripts/build_skills_index.ts, packages/schemas/src/memory_bank.ts]
 */

import { assert, assertEquals, assertExists } from "@std/assert";
import { ensureDir } from "@std/fs";
import { join, resolve } from "@std/path";
import { buildSkillsIndex } from "../../scripts/build_skills_index.ts";
import { SkillSchema } from "@exaix/schemas/memory_bank.ts";
import { SkillsService } from "@exaix/core/skills";
import { initTestDbService } from "@exaix/testing";

const FIXTURE_DIR = resolve(new URL("../fixtures/build_skills_index/", import.meta.url).pathname);
const GLOBAL_SKILL = Deno.readTextFileSync(join(FIXTURE_DIR, "test-global-skill.skill.md"));
const PROJECT_SKILL = Deno.readTextFileSync(join(FIXTURE_DIR, "test-project-skill.skill.md"));

async function makeFixture(): Promise<
  { skillsDir: string; targetDir: string; sandboxRoot: string; cleanup: () => void }
> {
  const sandboxRoot = await Deno.makeTempDir({ prefix: "build_skills_idx_" });
  const skillsDir = join(sandboxRoot, "Blueprints", "Skills");
  const targetDir = join(sandboxRoot, "Memory", "Skills");
  await ensureDir(skillsDir);
  Deno.writeTextFileSync(join(skillsDir, "test-global-skill.skill.md"), GLOBAL_SKILL);
  Deno.writeTextFileSync(join(skillsDir, "test-project-skill.skill.md"), PROJECT_SKILL);
  return {
    skillsDir,
    targetDir,
    sandboxRoot,
    cleanup: () => Deno.removeSync(sandboxRoot, { recursive: true }),
  };
}

Deno.test("[build_skills_index] generates one valid SkillSchema JSON per .skill.md", async () => {
  const { skillsDir, targetDir, sandboxRoot, cleanup } = await makeFixture();
  try {
    const result = await buildSkillsIndex(skillsDir, targetDir, sandboxRoot);
    assert(result.success, `expected success, errors: ${result.errors.join("; ")}`);
    assertEquals(result.generated.sort(), ["test-global-skill", "test-project-skill"]);

    const globalJson = JSON.parse(
      Deno.readTextFileSync(join(targetDir, "global", "test-global-skill.json")),
    );
    const parsed = SkillSchema.safeParse(globalJson);
    assert(parsed.success, "generated global JSON must satisfy SkillSchema");
    assertEquals(parsed.data!.instructions.includes("procedural instructions"), true);
  } finally {
    cleanup();
  }
});

Deno.test("[build_skills_index] routes scope:project skills under project/<project>/ (GAP-4)", async () => {
  const { skillsDir, targetDir, sandboxRoot, cleanup } = await makeFixture();
  try {
    await buildSkillsIndex(skillsDir, targetDir, sandboxRoot);
    // project-scoped → project/Exaix/, NOT global/
    const projectPath = join(targetDir, "project", "Exaix", "test-project-skill.json");
    assertExists(
      Deno.statSync(projectPath),
      "project-scoped skill must be written under project/<project>/",
    );
    // it must NOT be written to global/
    let inGlobal = true;
    try {
      Deno.statSync(join(targetDir, "global", "test-project-skill.json"));
    } catch {
      inGlobal = false;
    }
    assertEquals(inGlobal, false, "project-scoped skill must not be in global/");
  } finally {
    cleanup();
  }
});

Deno.test("[build_skills_index] --check fails when a generated JSON would drift from source", async () => {
  const { skillsDir, targetDir, sandboxRoot, cleanup } = await makeFixture();
  try {
    // First generate the JSON, then mutate the source so --check detects drift.
    await buildSkillsIndex(skillsDir, targetDir, sandboxRoot);
    const drifted = GLOBAL_SKILL.replace(
      "These are the procedural instructions for the global test skill.",
      "These instructions have changed and now drift from the generated JSON.",
    );
    Deno.writeTextFileSync(join(skillsDir, "test-global-skill.skill.md"), drifted);

    const check = await buildSkillsIndex(skillsDir, targetDir, sandboxRoot, { check: true });
    assertEquals(check.success, false, "--check must fail when source drifts from generated JSON");
    assert(
      check.errors.some((e) => e.includes("test-global-skill")),
      "drift error must name the drifted skill",
    );
  } finally {
    cleanup();
  }
});

Deno.test("[build_skills_index] --check passes when generated JSON matches source", async () => {
  const { skillsDir, targetDir, sandboxRoot, cleanup } = await makeFixture();
  try {
    await buildSkillsIndex(skillsDir, targetDir, sandboxRoot);
    const check = await buildSkillsIndex(skillsDir, targetDir, sandboxRoot, { check: true });
    assert(check.success, `--check must pass when in sync, errors: ${check.errors.join("; ")}`);
  } finally {
    cleanup();
  }
});

/** Count the authored `.skill.md` files on disk — the catalog's source of truth. */
function countSkillSourceFiles(skillsDir: string): number {
  let n = 0;
  for (const e of Deno.readDirSync(skillsDir)) {
    if (e.isFile && e.name.endsWith(".skill.md")) n++;
  }
  return n;
}

Deno.test(
  "[build_skills_index][integration] every Blueprints/Skills source generates and SkillsService loads them all (incl. project-scoped + previously-JSON-only)",
  { sanitizeOps: false, sanitizeResources: false },
  async () => {
    const repoRoot = resolve(new URL("../../", import.meta.url).pathname);
    const realSkillsDir = join(repoRoot, "Blueprints", "Skills");
    // Derive the expected count from the filesystem so the test tracks the catalog
    // automatically (mirrors the dynamic `check:skill-index` gate; no magic literal).
    const expectedCount = countSkillSourceFiles(realSkillsDir);
    assert(expectedCount > 0, "expected at least one .skill.md source file");

    const { db, config, cleanup } = await initTestDbService();
    try {
      const memoryDir = join(config.system.root, config.paths.memory);
      const targetDir = join(memoryDir, "Skills");
      const result = await buildSkillsIndex(realSkillsDir, targetDir, config.system.root);
      assert(result.success, `generation failed: ${result.errors.join("; ")}`);
      assertEquals(
        result.generated.length,
        expectedCount,
        `every .skill.md must generate (expected ${expectedCount} from disk, got ${result.generated.length})`,
      );

      const svc = new SkillsService({ memoryDir, portal: "Exaix" }, db);
      const skills = await svc.listSkills();
      const ids = skills.map((s) => s.skill_id).sort();
      assertEquals(
        skills.length,
        expectedCount,
        `SkillsService should load ${expectedCount} skills, got ${skills.length}: ${ids.join(", ")}`,
      );
      // The two previously JSON-only skills still load (now from generated JSON).
      assert(ids.includes("gap-analysis"), "gap-analysis must still load");
      assert(ids.includes("step-execution"), "step-execution must still load");
      // A project-scoped skill loads too.
      assert(ids.includes("portal-grounding"), "project-scoped portal-grounding must load");
    } finally {
      await cleanup();
    }
  },
);
