/**
 * @module CheckSkillSizeTest
 * @path tests/scripts/check_skill_size_test.ts
 * @description Regression test for `scripts/check_skill_size.ts`: flags a synthetic oversized
 *   skill folder and passes a normal-sized one, and confirms the threshold is read from the
 *   `DEFAULT_SKILL_SIZE_WARNING_CHARS` `configurable()` constant, not hardcoded. Skills are read
 *   through the production folder loader.
 * @architectural-layer Test
 * @related-files [scripts/check_skill_size.ts, packages/core/src/types/constants.ts]
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { DEFAULT_SKILL_SIZE_WARNING_CHARS } from "@exaix/core";
import { scanSkillSizes } from "../../scripts/check_skill_size.ts";

function writeSkillFolder(root: string, skillId: string, body: string): void {
  Deno.mkdirSync(join(root, skillId), { recursive: true });
  Deno.writeTextFileSync(
    join(root, skillId, "SKILL.md"),
    `---\nname: ${skillId}\ndescription: ${skillId}\n---\n${body}\n`,
  );
}

Deno.test("[check-skill-size] flags a synthetic oversized skill and passes a normal-sized one", async () => {
  const dir = await Deno.makeTempDir({ prefix: "check-skill-size-" });
  try {
    writeSkillFolder(dir, "oversized-skill", "x".repeat(DEFAULT_SKILL_SIZE_WARNING_CHARS + 1000));
    writeSkillFolder(dir, "normal-skill", "x".repeat(100));

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
    writeSkillFolder(dir, "at-threshold", "x".repeat(DEFAULT_SKILL_SIZE_WARNING_CHARS));

    assertEquals((await scanSkillSizes(dir)).length, 0, "exactly at the threshold is not oversized");
    assertEquals(
      (await scanSkillSizes(dir, DEFAULT_SKILL_SIZE_WARNING_CHARS - 1)).length,
      1,
      "an explicit lower threshold override must be honored",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("[check-skill-size] a small-instructions large-examples skill is flagged in full mode but not trimmed", async () => {
  const dir = await Deno.makeTempDir({ prefix: "check-skill-size-examples-" });
  try {
    // The full renderer injects the whole body, so a large Examples section exceeds the threshold.
    const body = "Do the thing.\n\n## Examples\n\n" + "y".repeat(DEFAULT_SKILL_SIZE_WARNING_CHARS);
    writeSkillFolder(dir, "example-heavy-skill", body);

    const fullFindings = await scanSkillSizes(dir);
    assertEquals(fullFindings.length, 1, "full render mode must flag the examples-heavy skill");
    assertEquals(fullFindings[0].mode, "full");
    assertEquals(fullFindings[0].skillId, "example-heavy-skill");
    assertEquals(fullFindings[0].length, body.length, "full-mode length is the complete rendered body");

    const trimmedFindings = await scanSkillSizes(dir, DEFAULT_SKILL_SIZE_WARNING_CHARS, "trimmed");
    assertEquals(trimmedFindings.length, 0, "trimmed render mode must not flag the examples-heavy skill");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
