/**
 * @module SkillFolderRenderParityTest
 * @path tests/blueprints/skill_folder_render_parity_test.ts
 * @description Phase 206 Step 3 — the 27 converted skill folders reproduce the rendered
 *   prompt blocks and every authored field captured from the former compiled JSON store.
 *   The golden fixture is the independent baseline captured before conversion.
 * @architectural-layer Test
 * @dependencies [@std/assert, @exaix/testing, @exaix/core/func]
 * @related-files [tests/blueprints/fixtures/skill_render_goldens.json]
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { MemoryScope } from "@exaix/core";
import { renderCriticalSkillsSection, renderSkillsSection } from "@exaix/core/func";
import type { ISkill } from "@exaix/schemas/memory_bank.ts";
import { loadRepoSkillCatalog, REPO_ROOT, skillMatchFixture } from "@exaix/testing";

/** Authored fields compared one by one against the folder-loaded skill. */
const COMPARED_FIELDS = [
  "status",
  "description",
  "triggers",
  "instructions",
  "constraints",
  "output_requirements",
  "quality_criteria",
  "compatible_with",
  "critical",
  "examples",
  "tools",
  "effort",
] as const;

interface IGolden {
  scope: string;
  project: string | null;
  fields: { name: string } & Partial<Pick<ISkill, typeof COMPARED_FIELDS[number]>>;
  full: string;
  trimmed: string;
  critical: string;
}

const GOLDEN_COUNT = 27;
const GLOBAL_COUNT = 26;
const goldens: Record<string, IGolden> = JSON.parse(
  Deno.readTextFileSync(join(REPO_ROOT, "tests", "blueprints", "fixtures", "skill_render_goldens.json")),
);

Deno.test("[catalog] the loader discovers exactly 26 global and 1 project skill folders", async () => {
  const catalog = await loadRepoSkillCatalog();
  assertEquals(catalog.size, GOLDEN_COUNT);
  const scopes = [...catalog.values()].map((entry) => entry.skill.scope);
  assertEquals(scopes.filter((scope) => scope === MemoryScope.GLOBAL).length, GLOBAL_COUNT);
  assertEquals(scopes.filter((scope) => scope === MemoryScope.PROJECT).length, 1);
  assertEquals(catalog.get("portal-grounding")?.skill.project, "Exaix");
  assertEquals([...catalog.keys()].sort(), Object.keys(goldens).sort());
});

Deno.test("[catalog] all 27 converted skills render byte-identically to the golden blocks", async () => {
  const catalog = await loadRepoSkillCatalog();
  for (const [name, golden] of Object.entries(goldens)) {
    const skill = catalog.get(name)?.skill;
    if (!skill) throw new Error(`skill ${name} missing from the catalog`);
    const context = {
      matched: [skillMatchFixture({
        skillId: skill.skill_id,
        revisionId: skill.id,
        name: skill.title,
        description: skill.description,
        content: skill.instructions,
        confidence: 0.5,
        tags: skill.triggers.tags || [],
        critical: skill.critical ?? false,
        effort: skill.effort,
        thinking: skill.thinking,
        examples: skill.examples,
      })],
      totalAvailable: 1,
      retrievalLatencyMs: 0,
    };
    assertEquals(renderSkillsSection(context), golden.full, `${name} full`);
    assertEquals(renderSkillsSection(context, true), golden.trimmed, `${name} trimmed`);
    assertEquals(renderCriticalSkillsSection(context), golden.critical, `${name} critical`);
  }
});

Deno.test("[catalog] every authored field survives conversion, with title carrying the old display name", async () => {
  const catalog = await loadRepoSkillCatalog();
  for (const [name, golden] of Object.entries(goldens)) {
    const skill = catalog.get(name)!.skill;
    assertEquals(skill.title, golden.fields.name, `${name} title`);
    assertEquals(skill.scope, golden.scope, `${name} scope`);
    for (const field of COMPARED_FIELDS) {
      assertEquals(skill[field], golden.fields[field], `${name}.${field}`);
    }
  }
});
