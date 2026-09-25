/**
 * @module SkillSchemaEffortTest
 * @path packages/schemas/tests/skill_schema_effort_test.ts
 * @description Verifies SkillSchema accepts and round-trips declaration-time effort
 *   (a concrete tier — a floor, never "auto") and thinking (a boolean floor), per
 *   phase-197 Step 3.
 * @architectural-layer Schemas
 * @related-files [packages/schemas/src/memory_bank.ts]
 */

import { assertEquals } from "@std/assert";
import { SkillSchema } from "@exaix/schemas/memory_bank.ts";
import type { ISkill } from "@exaix/schemas/memory_bank.ts";

function skillParts(): object {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    created_at: "2026-01-01T00:00:00.000Z",
    source: "user",
    scope: "global",
    project: "exaix",
    status: "active",
    skill_id: "response-contract-security-analysis",
    name: "Security Analysis",
    version: "1.0.0",
    description: "A security analysis skill.",
    triggers: {},
    instructions: "Perform the security analysis thoroughly and carefully.",
  };
}

Deno.test("SkillSchema: accepts effort medium and thinking true as floors", () => {
  const parsed = SkillSchema.parse({ ...skillParts(), effort: "medium", thinking: true }) as ISkill;
  assertEquals(parsed.effort, "medium");
  assertEquals(parsed.thinking, true);
});

Deno.test("SkillSchema: round-trips the concrete tier floors", () => {
  for (const tier of ["low", "medium", "high"]) {
    const parsed = SkillSchema.parse({ ...skillParts(), effort: tier }) as ISkill;
    assertEquals(parsed.effort, tier);
  }
});

Deno.test("SkillSchema: rejects effort auto (floors are concrete only)", () => {
  const result = SkillSchema.safeParse({ ...skillParts(), effort: "auto" });
  assertEquals(result.success, false);
});

Deno.test("SkillSchema: rejects a nonsense thinking floor", () => {
  const result = SkillSchema.safeParse({ ...skillParts(), thinking: "auto" });
  assertEquals(result.success, false);
});

Deno.test("SkillSchema: floors are optional", () => {
  const parsed = SkillSchema.parse(skillParts()) as ISkill;
  assertEquals(parsed.effort, undefined);
  assertEquals(parsed.thinking, undefined);
});
