/**
 * @module SkillFolderRenderParityTest
 * @path tests/blueprints/skill_folder_render_parity_test.ts
 * @description Phase 206 Step 3 — the converted skill folders reproduce the rendered
 *   prompt blocks and authored fields captured from the former compiled JSON store, using frozen fixtures.
 *   The golden fixture is the independent baseline captured before conversion.
 * @architectural-layer Test
 * @dependencies [@std/assert, @exaix/testing, @exaix/core/func]
 * @related-files [tests/blueprints/fixtures/skill_render_goldens.json]
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { renderCriticalSkillsSection, renderSkillsSection } from "@exaix/core/func";
import type { ISkill } from "@exaix/schemas/memory_bank.ts";
import {
  createSkillLoaderFor,
  REPO_ROOT,
  skillMatchFixture,
  testSkillContext,
  withTempDir,
  writeSkillFolder,
} from "@exaix/testing";
import { SkillRootKind } from "@exaix/core";
import type { ILoadedSkill } from "@exaix/core/skills";
import { SkillSidecarSchema } from "@exaix/schemas/skill_folder.ts";

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

const goldens: Record<string, IGolden> = JSON.parse(
  Deno.readTextFileSync(join(REPO_ROOT, "tests", "blueprints", "fixtures", "skill_render_goldens.json")),
);

/** Builds frozen conversion inputs so approved live-skill edits do not change this historical compatibility test. */
async function loadGoldenCatalog(root: string): Promise<Map<string, ILoadedSkill>> {
  const blueprint = join(root, "blueprint");
  const project = join(root, "project");
  for (const [name, golden] of Object.entries(goldens)) {
    const fields = golden.fields;
    const sidecar = SkillSidecarSchema.parse(Object.fromEntries(
      Object.entries({
        title: fields.name,
        status: fields.status,
        triggers: fields.triggers,
        constraints: fields.constraints,
        output_requirements: fields.output_requirements,
        quality_criteria: fields.quality_criteria,
        critical: fields.critical,
        tools: fields.tools,
        effort: fields.effort,
        applies_to: fields.compatible_with,
      }).filter(([, value]) => value !== undefined),
    ));
    await writeSkillFolder(golden.scope === "project" ? project : blueprint, {
      name,
      description: fields.description,
      instructions: fields.instructions ?? "",
      sidecar,
    });
  }
  const loader = createSkillLoaderFor([
    { path: project, kind: SkillRootKind.PROJECT, writable: false, project: "Exaix" },
    { path: blueprint, kind: SkillRootKind.BLUEPRINT, writable: false, project: null },
  ]);
  const context = testSkillContext();
  const loaded = await loader.list(context);
  assertEquals(await loader.diagnostics(context), []);
  return new Map(loaded.map((entry) => [entry.skill.name, entry]));
}

Deno.test("[catalog] frozen conversion folders preserve golden scope and identity", () =>
  withTempDir(async (root) => {
    const catalog = await loadGoldenCatalog(root);
    for (const [name, golden] of Object.entries(goldens)) {
      assertEquals(catalog.get(name)?.skill.scope, golden.scope, `${name} scope`);
    }
    assertEquals(catalog.get("portal-grounding")?.skill.project, "Exaix");
    assertEquals([...catalog.keys()].sort(), Object.keys(goldens).sort());
  }));

Deno.test("[catalog] every converted skill renders byte-identically to the golden blocks", () =>
  withTempDir(async (root) => {
    const catalog = await loadGoldenCatalog(root);
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
  }));

Deno.test("[catalog] every authored field survives conversion, with title carrying the old display name", () =>
  withTempDir(async (root) => {
    const catalog = await loadGoldenCatalog(root);
    for (const [name, golden] of Object.entries(goldens)) {
      const skill = catalog.get(name)!.skill;
      assertEquals(skill.title, golden.fields.name, `${name} title`);
      assertEquals(skill.scope, golden.scope, `${name} scope`);
      for (const field of COMPARED_FIELDS) {
        assertEquals(skill[field], golden.fields[field], `${name}.${field}`);
      }
    }
  }));
