/**
 * @module DogfoodSkillsTest
 * @path packages/core/tests/skills/dogfood_skills_test.ts
 * @description Phase 122 Step 2 — verifies the gap-analysis and step-execution skills
 *   are loadable from Memory/Skills/global/ and validate against SkillSchema with
 *   non-empty instructions and correct tag triggers.
 * @architectural-layer Integration
 * @dependencies [@exaix/schemas, @std/path]
 * @related-files []
 */

import { assertEquals, assertNotEquals } from "@std/assert";
import { join } from "@std/path";
import { SkillSchema } from "@exaix/schemas/memory_bank.ts";

const REPO_ROOT = join(import.meta.dirname!, "..", "..", "..", "..");
const MEMORY_SKILLS_GLOBAL = join(REPO_ROOT, "Memory", "Skills", "global");

Deno.test("[dogfood-skills] gap-analysis validates against SkillSchema", async () => {
  const raw = await Deno.readTextFile(join(MEMORY_SKILLS_GLOBAL, "gap-analysis.json"));
  const parsed = JSON.parse(raw);
  const result = SkillSchema.safeParse(parsed);

  if (!result.success) {
    throw new Error(`gap-analysis failed SkillSchema: ${result.error.message}`);
  }
  assertEquals(result.data.skill_id, "gap-analysis");
  assertEquals(result.data.triggers?.tags?.includes("pre-gap"), true, "must be tagged pre-gap");
  assertEquals(result.data.triggers?.tags?.includes("plan-review"), true, "must be tagged plan-review");
  assertEquals(result.data.instructions.length >= 10, true, "instructions must be non-empty");
});

Deno.test("[dogfood-skills] step-execution validates against SkillSchema", async () => {
  const raw = await Deno.readTextFile(join(MEMORY_SKILLS_GLOBAL, "step-execution.json"));
  const parsed = JSON.parse(raw);
  const result = SkillSchema.safeParse(parsed);

  if (!result.success) {
    throw new Error(`step-execution failed SkillSchema: ${result.error.message}`);
  }
  assertEquals(result.data.skill_id, "step-execution");
  assertEquals(result.data.triggers?.tags?.includes("step-execution"), true, "must be tagged step-execution");
  assertEquals(result.data.triggers?.tags?.includes("next-steps"), true, "must be tagged next-steps");
  assertEquals(result.data.instructions.length >= 10, true, "instructions must be non-empty");
});

Deno.test("[dogfood-skills] both skills have non-empty instructions", async () => {
  for (const slug of ["gap-analysis", "step-execution"]) {
    const raw = await Deno.readTextFile(join(MEMORY_SKILLS_GLOBAL, `${slug}.json`));
    const parsed = SkillSchema.parse(JSON.parse(raw));
    assertNotEquals(parsed.instructions.length, 0, `${slug} must have non-empty instructions`);
  }
});
