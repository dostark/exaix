/**
 * @module SkillCatalogIntegrityTest
 * @path tests/eval/skill_catalog_integrity_test.ts
 * @architectural-layer Test
 * @description Asserts the authored skill folders load as one catalog: every folder is valid, no
 *   compiled copy exists beside them, and the rendering order of the `commit-message` skill stays
 *   intact. Skills have a single source, so there is no seed-to-runtime drift to check.
 * @dependencies [@exaix/testing]
 * @related-files [tests/eval/runtime_skill_scopes.ts, scripts/check_skills.ts]
 */
import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { loadRepoSkillCatalog, REPO_ROOT } from "@exaix/testing";
import { checkSkillCatalog } from "../../scripts/check_skills.ts";

Deno.test("skill_catalog_integrity — every authored skill folder is valid", async () => {
  const result = await checkSkillCatalog(REPO_ROOT);
  assertEquals(result.errors, []);
});

Deno.test("skill_catalog_integrity — no compiled JSON skill store exists beside the folders", async () => {
  for (const legacy of [join("Memory", "Skills", "global"), join("Memory", "Skills", "index.json")]) {
    assertEquals(await Deno.stat(join(REPO_ROOT, legacy)).catch(() => null), null, `${legacy} must not exist`);
  }
});

Deno.test("skill_catalog_integrity — commit-message keeps Examples before Subject Line Rules in full-mode rendering", async () => {
  const skill = (await loadRepoSkillCatalog()).get("commit-message")?.skill;
  assert(skill, "commit-message skill must exist");
  // Full-mode rendering uses `instructions` verbatim, with Examples in their authored position.
  const examplesAt = skill.instructions.indexOf("## Examples");
  const subjectAt = skill.instructions.indexOf("## Subject Line Rules");
  assert(examplesAt >= 0, "Examples heading must be present in full instructions");
  assert(subjectAt > examplesAt, "Examples must precede Subject Line Rules in full mode (original ordering)");
});
