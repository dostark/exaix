/**
 * @module SkillSchemaEffortTest
 * @path packages/schemas/tests/skill_schema_effort_test.ts
 * @description Verifies the skill sidecar schema accepts and round-trips declaration-time
 *   effort (a concrete tier, a floor, never "auto") and thinking (a boolean floor).
 * @architectural-layer Schemas
 * @related-files [packages/schemas/src/skill_folder.ts]
 */

import { assertEquals } from "@std/assert";
import { SkillSidecarSchema } from "@exaix/schemas/skill_folder.ts";

Deno.test("SkillSidecarSchema: accepts effort medium and thinking true as floors", () => {
  const parsed = SkillSidecarSchema.parse({ effort: "medium", thinking: true });
  assertEquals(parsed.effort, "medium");
  assertEquals(parsed.thinking, true);
});

Deno.test("SkillSidecarSchema: round-trips the concrete tier floors", () => {
  for (const tier of ["low", "medium", "high"]) {
    assertEquals(SkillSidecarSchema.parse({ effort: tier }).effort, tier);
  }
});

Deno.test("SkillSidecarSchema: rejects effort auto (floors are concrete only)", () => {
  assertEquals(SkillSidecarSchema.safeParse({ effort: "auto" }).success, false);
});

Deno.test("SkillSidecarSchema: rejects a nonsense thinking floor", () => {
  assertEquals(SkillSidecarSchema.safeParse({ thinking: "auto" }).success, false);
});

Deno.test("SkillSidecarSchema: floors are optional", () => {
  const parsed = SkillSidecarSchema.parse({});
  assertEquals(parsed.effort, undefined);
  assertEquals(parsed.thinking, undefined);
});
