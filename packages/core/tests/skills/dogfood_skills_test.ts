/**
 * @module DogfoodSkillsTest
 * @path packages/core/tests/skills/dogfood_skills_test.ts
 * @description Phase 122 Step 2 — verifies the gap-analysis and step-execution skills
 *   are loadable from Memory/Skills/global/ and validate against SkillSchema with
 *   non-empty instructions and correct tag triggers. Also verifies runtime loading
 *   through SkillsService.getSkill (GAP-12 remediation).
 * @architectural-layer Integration
 * @dependencies [@exaix/schemas, @std/path, @exaix/testing, @exaix/core/skills]
 * @related-files []
 */

import { assertEquals, assertExists, assertNotEquals } from "@std/assert";
import { join } from "@std/path";
import { SkillSchema } from "@exaix/schemas/memory_bank.ts";
import { SkillsService } from "@exaix/core/skills";
import { initTestDbService } from "@exaix/testing";
import { MemoryScope } from "@exaix/core";

const REPO_ROOT = join(import.meta.dirname!, "..", "..", "..", "..");
const MEMORY_SKILLS_GLOBAL = join(REPO_ROOT, "Memory", "Skills", "global");
const SKILL_SLUGS = ["gap-analysis", "step-execution"] as const;

// ===== Schema validation tests (structural integrity) =====

for (const slug of SKILL_SLUGS) {
  Deno.test(`[dogfood-skills] ${slug} validates against SkillSchema`, async () => {
    const raw = await Deno.readTextFile(join(MEMORY_SKILLS_GLOBAL, `${slug}.json`));
    const parsed = JSON.parse(raw);
    const result = SkillSchema.safeParse(parsed);

    if (!result.success) {
      throw new Error(`${slug} failed SkillSchema: ${result.error.message}`);
    }
    assertEquals(result.data.skill_id, slug);
    assertEquals(result.data.instructions.length >= 10, true, "instructions must be non-empty");
  });
}

Deno.test("[dogfood-skills] gap-analysis has pre-gap and plan-review tags", async () => {
  const parsed = SkillSchema.parse(JSON.parse(
    await Deno.readTextFile(join(MEMORY_SKILLS_GLOBAL, "gap-analysis.json")),
  ));
  assertEquals(parsed.triggers?.tags?.includes("pre-gap"), true);
  assertEquals(parsed.triggers?.tags?.includes("plan-review"), true);
});

Deno.test("[dogfood-skills] step-execution has step-execution and next-steps tags", async () => {
  const parsed = SkillSchema.parse(JSON.parse(
    await Deno.readTextFile(join(MEMORY_SKILLS_GLOBAL, "step-execution.json")),
  ));
  assertEquals(parsed.triggers?.tags?.includes("step-execution"), true);
  assertEquals(parsed.triggers?.tags?.includes("next-steps"), true);
});

Deno.test("[dogfood-skills] both skills have non-empty instructions", async () => {
  for (const slug of SKILL_SLUGS) {
    const parsed = SkillSchema.parse(JSON.parse(
      await Deno.readTextFile(join(MEMORY_SKILLS_GLOBAL, `${slug}.json`)),
    ));
    assertNotEquals(parsed.instructions.length, 0, `${slug} must have non-empty instructions`);
  }
});

// ===== Runtime loading tests (SkillsService.getSkill) =====

function seedSkillDir(skillsDir: string): Promise<void> {
  return seedSkillFiles(skillsDir);
}

async function seedSkillFiles(skillsDir: string): Promise<void> {
  const globalDir = join(skillsDir, MemoryScope.GLOBAL);
  await Deno.mkdir(globalDir, { recursive: true });

  for (const slug of SKILL_SLUGS) {
    const src = join(MEMORY_SKILLS_GLOBAL, `${slug}.json`);
    const dst = join(globalDir, `${slug}.json`);
    const content = await Deno.readTextFile(src);
    await Deno.writeTextFile(dst, content);
  }
}

Deno.test("[dogfood-skills] gap-analysis loads through SkillsService.getSkill", async () => {
  const { db, config, cleanup } = await initTestDbService();
  try {
    const memoryDir = join(config.system.root, config.paths.memory);
    const skillsDir = join(memoryDir, "Skills");
    await seedSkillDir(skillsDir);

    const service = new SkillsService({ memoryDir }, db);
    await service.initialize();

    const skill = await service.getSkill("gap-analysis");
    assertExists(skill, "gap-analysis must hydrate through getSkill");
    assertEquals(skill.skill_id, "gap-analysis");
    assertEquals(skill.instructions.length >= 10, true);
    assertEquals(skill.triggers?.tags?.includes("pre-gap"), true);
  } finally {
    await cleanup();
  }
});

Deno.test("[dogfood-skills] step-execution loads through SkillsService.getSkill", async () => {
  const { db, config, cleanup } = await initTestDbService();
  try {
    const memoryDir = join(config.system.root, config.paths.memory);
    const skillsDir = join(memoryDir, "Skills");
    await seedSkillDir(skillsDir);

    const service = new SkillsService({ memoryDir }, db);
    await service.initialize();

    const skill = await service.getSkill("step-execution");
    assertExists(skill, "step-execution must hydrate through getSkill");
    assertEquals(skill.skill_id, "step-execution");
    assertEquals(skill.instructions.length >= 10, true);
    assertEquals(skill.triggers?.tags?.includes("step-execution"), true);
  } finally {
    await cleanup();
  }
});
