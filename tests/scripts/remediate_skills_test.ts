/**
 * @module RemediateSkillsTest
 * @path tests/scripts/remediate_skills_test.ts
 * @description Phase 125 Step 4 — verifies the remediate-plan-gaps and
 *   remediate-code-gaps skills exist in .copilot/skills/ with valid exaix
 *   blocks and generate runtime-valid JSON.
 * @architectural-layer Unit
 * @dependencies [@std/assert, @std/path, @std/yaml]
 * @related-files [.copilot/skills/remediate-plan-gaps/SKILL.md, .copilot/skills/remediate-code-gaps/SKILL.md, scripts/generate_skill_json.ts]
 */

import { assert, assertEquals, assertExists } from "@std/assert";
import { join } from "@std/path";
import { parse as parseYaml } from "@std/yaml";
import { SkillSchema } from "@exaix/schemas/memory_bank.ts";
import {
  generateSkillJson,
  type IGenerateSkillJsonResult,
  type ISkillMdData,
} from "../../scripts/generate_skill_json.ts";

const REPO_ROOT = join(import.meta.dirname!, "..", "..");

function getSkillMdPath(skillName: string): string {
  return join(REPO_ROOT, ".copilot", "skills", skillName, "SKILL.md");
}

Deno.test("[remediate_skills] remediate-plan-gaps SKILL.md exists and has valid exaix block", async () => {
  const path = getSkillMdPath("remediate-plan-gaps");
  const content = await Deno.readTextFile(path);

  const exaixMatch = content.match(/---\n\s*exaix:\n[\s\S]*?\n---/);
  assertExists(exaixMatch, "SKILL.md must contain an exaix block");
  const exaixYaml = exaixMatch[0].replace(/^---\n/, "").replace(/\n---$/, "");
  const parsed = parseYaml(exaixYaml) as ISkillMdData;
  assertExists(parsed?.exaix, "exaix block must parse as YAML");

  const exaixBlock = parsed.exaix as ISkillMdData;
  const triggers = exaixBlock?.triggers as ISkillMdData;
  const tags = (triggers?.tags ?? []) as string[];
  assert(tags.includes("remediate-plan"), `tags must include remediate-plan, got ${JSON.stringify(tags)}`);
});

Deno.test("[remediate_skills] remediate-code-gaps SKILL.md exists and has valid exaix block", async () => {
  const path = getSkillMdPath("remediate-code-gaps");
  const content = await Deno.readTextFile(path);

  const exaixMatch = content.match(/---\n\s*exaix:\n[\s\S]*?\n---/);
  assertExists(exaixMatch, "SKILL.md must contain an exaix block");
  const exaixYaml = exaixMatch[0].replace(/^---\n/, "").replace(/\n---$/, "");
  const parsed = parseYaml(exaixYaml) as ISkillMdData;
  assertExists(parsed?.exaix, "exaix block must parse as YAML");

  const exaixBlock = parsed.exaix as ISkillMdData;
  const triggers = exaixBlock?.triggers as ISkillMdData;
  const tags = (triggers?.tags ?? []) as string[];
  assert(tags.includes("remediate-code"), `tags must include remediate-code, got ${JSON.stringify(tags)}`);
});

Deno.test("[remediate_skills] remediate-plan-gaps generates runtime-valid JSON with tag remediate-plan", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "remediate-plan-test-" });
  try {
    const skillsDir = join(tempDir, "skills", "remediate-plan-gaps");
    Deno.mkdirSync(skillsDir, { recursive: true });
    const realFile = getSkillMdPath("remediate-plan-gaps");
    const realContent = await Deno.readTextFile(realFile);
    Deno.writeTextFileSync(join(skillsDir, "SKILL.md"), realContent);

    const targetDir = join(tempDir, "target", "Memory", "Skills");
    const sandboxRoot = join(tempDir, "target");

    const result: IGenerateSkillJsonResult = await generateSkillJson(
      join(tempDir, "skills"),
      targetDir,
      sandboxRoot,
    );

    assertEquals(result.success, true, `generator failed: ${result.errors.join(", ")}`);
    assertEquals(result.generated.length, 1);

    const jsonPath = join(targetDir, "global", "remediate-plan-gaps.json");
    const jsonContent = JSON.parse(Deno.readTextFileSync(jsonPath));

    assertEquals(jsonContent.skill_id, "remediate-plan-gaps");
    assertEquals(jsonContent.status, "active");
    assertEquals(jsonContent.source, "user");

    const tags = jsonContent.triggers?.tags ?? [];
    assert(tags.includes("remediate-plan"), `tags must include remediate-plan, got ${JSON.stringify(tags)}`);

    const parsed = SkillSchema.safeParse(jsonContent);
    assertEquals(parsed.success, true, "generated JSON must satisfy SkillSchema");
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("[remediate_skills] remediate-code-gaps generates runtime-valid JSON with tag remediate-code", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "remediate-code-test-" });
  try {
    const skillsDir = join(tempDir, "skills", "remediate-code-gaps");
    Deno.mkdirSync(skillsDir, { recursive: true });
    const realFile = getSkillMdPath("remediate-code-gaps");
    const realContent = await Deno.readTextFile(realFile);
    Deno.writeTextFileSync(join(skillsDir, "SKILL.md"), realContent);

    const targetDir = join(tempDir, "target", "Memory", "Skills");
    const sandboxRoot = join(tempDir, "target");

    const result: IGenerateSkillJsonResult = await generateSkillJson(
      join(tempDir, "skills"),
      targetDir,
      sandboxRoot,
    );

    assertEquals(result.success, true, `generator failed: ${result.errors.join(", ")}`);
    assertEquals(result.generated.length, 1);

    const jsonPath = join(targetDir, "global", "remediate-code-gaps.json");
    const jsonContent = JSON.parse(Deno.readTextFileSync(jsonPath));

    assertEquals(jsonContent.skill_id, "remediate-code-gaps");
    assertEquals(jsonContent.status, "active");
    assertEquals(jsonContent.source, "user");

    const tags = jsonContent.triggers?.tags ?? [];
    assert(tags.includes("remediate-code"), `tags must include remediate-code, got ${JSON.stringify(tags)}`);

    const parsed = SkillSchema.safeParse(jsonContent);
    assertEquals(parsed.success, true, "generated JSON must satisfy SkillSchema");
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});
