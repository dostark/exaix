/**
 * @module DogfoodSkillsTest
 * @path packages/core/tests/skills/dogfood_skills_test.ts
 * @description Phase 122 Step 2 — verifies the gap-analysis and step-execution skills load
 *   from the Blueprint skill folders with non-empty instructions and correct tag triggers,
 *   both through the loader and through SkillsService.getSkill.
 * @architectural-layer Integration
 * @dependencies [@std/assert, @std/path, @exaix/testing, @exaix/core/skills]
 * @related-files []
 */

import { assertEquals, assertExists, assertNotEquals } from "@std/assert";
import { join } from "@std/path";
import { SkillsService } from "@exaix/core/skills";
import { initTestDbService, loadRepoSkillCatalog, REPO_ROOT } from "@exaix/testing";

const SKILL_SLUGS = ["gap-analysis", "step-execution"] as const;
const MIN_INSTRUCTIONS_LENGTH = 10;

for (const slug of SKILL_SLUGS) {
  Deno.test(`[dogfood-skills] ${slug} loads as a valid active folder with instructions`, async () => {
    const catalog = await loadRepoSkillCatalog();
    const skill = catalog.get(slug)?.skill;
    assertExists(skill, `${slug} must load from the Blueprint skill folders`);
    assertEquals(skill.skill_id, slug);
    assertEquals(skill.instructions.length >= MIN_INSTRUCTIONS_LENGTH, true, "instructions must be non-empty");
  });
}

Deno.test("[dogfood-skills] gap-analysis has pre-gap and plan-review tags", async () => {
  const skill = (await loadRepoSkillCatalog()).get("gap-analysis")!.skill;
  assertEquals(skill.triggers.tags?.includes("pre-gap"), true);
  assertEquals(skill.triggers.tags?.includes("plan-review"), true);
});

Deno.test("[dogfood-skills] step-execution has step-execution and next-steps tags", async () => {
  const skill = (await loadRepoSkillCatalog()).get("step-execution")!.skill;
  assertEquals(skill.triggers.tags?.includes("step-execution"), true);
  assertEquals(skill.triggers.tags?.includes("next-steps"), true);
});

Deno.test("[dogfood-skills] both skills have non-empty instructions", async () => {
  const catalog = await loadRepoSkillCatalog();
  for (const slug of SKILL_SLUGS) {
    assertNotEquals(catalog.get(slug)!.skill.instructions.length, 0, `${slug} must have non-empty instructions`);
  }
});

for (const slug of SKILL_SLUGS) {
  Deno.test(`[dogfood-skills] ${slug} loads through SkillsService.getSkill`, async () => {
    const { db, config, cleanup } = await initTestDbService();
    try {
      const memoryDir = join(config.system.root, config.paths.memory);
      const service = new SkillsService({ memoryDir, blueprintSkillsDir: join(REPO_ROOT, "Blueprints", "Skills") }, db);
      await service.initialize();

      const skill = await service.getSkill(slug);
      assertExists(skill, `${slug} must hydrate through getSkill`);
      assertEquals(skill.skill_id, slug);
      assertEquals(skill.instructions.length >= MIN_INSTRUCTIONS_LENGTH, true);
    } finally {
      await cleanup();
    }
  });
}
