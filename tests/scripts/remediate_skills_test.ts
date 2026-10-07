/**
 * @module RemediateSkillsTest
 * @path tests/scripts/remediate_skills_test.ts
 * @description The remediate-plan-gaps and remediate-code-gaps dev skills load as active dogfood folders
 *   whose sidecar triggers carry the remediate tags.
 * @architectural-layer Unit
 * @dependencies [@std/assert, @std/path, @exaix/core]
 * @related-files [scripts/skill_catalog_loader.ts]
 */

import { assert, assertEquals, assertExists } from "@std/assert";
import { join } from "@std/path";
import { SkillRootKind, SkillStatus } from "@exaix/core";
import { loadCatalogRoot } from "../../scripts/skill_catalog_loader.ts";

const REPO_ROOT = join(import.meta.dirname!, "..", "..");

const EXPECTED_TAGS: ReadonlyArray<readonly [string, string]> = [
  ["remediate-plan-gaps", "remediate-plan"],
  ["remediate-code-gaps", "remediate-code"],
];

for (const [name, tag] of EXPECTED_TAGS) {
  Deno.test(`[remediate_skills] ${name} loads as an active dogfood folder with tag ${tag}`, async () => {
    const loaded = await loadCatalogRoot(join(REPO_ROOT, ".copilot", "skills"), SkillRootKind.DOGFOOD);
    const skill = loaded.find((entry) => entry.skill.name === name)?.skill;
    assertExists(skill, `${name} must load from .copilot/skills`);
    assertEquals(skill.status, SkillStatus.ACTIVE);
    assertEquals(skill.triggers_source, "authored");
    const tags = skill.triggers.tags ?? [];
    assert(tags.includes(tag), `tags must include ${tag}, got ${JSON.stringify(tags)}`);
  });
}
