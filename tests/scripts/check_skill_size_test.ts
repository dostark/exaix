/**
 * @module CheckSkillSizeTest
 * @path tests/scripts/check_skill_size_test.ts
 * @description Regression test for `scripts/check_skill_size.ts` (Phase 196 Step 3):
 *   flags a synthetic oversized skill JSON fixture and passes a synthetic normal-sized
 *   one, and confirms the threshold is read from the `DEFAULT_SKILL_SIZE_WARNING_CHARS`
 *   `configurable()` constant, not hardcoded.
 * @architectural-layer Test
 * @related-files [scripts/check_skill_size.ts, packages/core/src/types/constants.ts]
 */

import { assertEquals } from "@std/assert";
import { DEFAULT_SKILL_SIZE_WARNING_CHARS } from "@exaix/core";
import { scanSkillSizes } from "../../scripts/check_skill_size.ts";

function writeSkillJson(dir: string, skillId: string, instructionsLength: number): void {
  const skill = {
    id: crypto.randomUUID(),
    created_at: new Date().toISOString(),
    source: "user",
    scope: "global",
    status: "active",
    skill_id: skillId,
    name: skillId,
    version: "1.0.0",
    description: skillId,
    triggers: {},
    instructions: "x".repeat(instructionsLength),
    constraints: [],
    output_requirements: [],
    quality_criteria: [],
    compatible_with: { agents: ["*"] },
    usage_count: 0,
  };
  Deno.writeTextFileSync(`${dir}/${skillId}.json`, JSON.stringify(skill));
}

Deno.test("[check-skill-size] flags a synthetic oversized skill and passes a normal-sized one", async () => {
  const dir = await Deno.makeTempDir({ prefix: "check-skill-size-" });
  try {
    writeSkillJson(dir, "oversized-skill", DEFAULT_SKILL_SIZE_WARNING_CHARS + 1000);
    writeSkillJson(dir, "normal-skill", 100);

    const findings = await scanSkillSizes(dir);

    assertEquals(findings.length, 1);
    assertEquals(findings[0].skillId, "oversized-skill");
    assertEquals(findings[0].length, DEFAULT_SKILL_SIZE_WARNING_CHARS + 1000);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("[check-skill-size] threshold is read from the configurable() constant, not hardcoded", async () => {
  const dir = await Deno.makeTempDir({ prefix: "check-skill-size-threshold-" });
  try {
    writeSkillJson(dir, "at-threshold", DEFAULT_SKILL_SIZE_WARNING_CHARS);

    const findingsAtDefault = await scanSkillSizes(dir);
    assertEquals(findingsAtDefault.length, 0, "exactly at the threshold is not oversized");

    const findingsWithOverride = await scanSkillSizes(dir, DEFAULT_SKILL_SIZE_WARNING_CHARS - 1);
    assertEquals(findingsWithOverride.length, 1, "an explicit lower threshold override must be honored");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
