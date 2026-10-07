/**
 * @module DogfoodSkillFoldersTest
 * @path tests/scripts/dogfood_skill_folders_test.ts
 * @description The 28 `.copilot/skills` folders load directly through the folder loader as a dogfood root.
 *   Every folder reproduces the independent baseline captured from the removed generator, field for field,
 *   and the three runtime ids that differed from their folder names are pinned by an explicit alias table.
 * @architectural-layer Test
 * @related-files [tests/fixtures/skills/dogfood_baseline.json, packages/core/src/skills/skill_folder_loader.ts]
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { SkillRootKind } from "@exaix/core";
import { SkillFolderLoader } from "@exaix/core/skills";
import { createNoopEventLogger } from "@exaix/core/logger";
import { EventRegistry } from "@exaix/core/events";
import { createPathSecurity } from "@exaix/tool-runtime";
import { REPO_ROOT, testSkillContext } from "@exaix/testing";

interface IBaselineCriterion {
  name: string;
  description: string;
  weight: number;
}

interface IBaselineTriggers {
  keywords?: string[];
  task_types?: string[];
  file_patterns?: string[];
  tags?: string[];
}

interface IBaselineSkill {
  skill_id: string;
  name: string;
  description: string;
  triggers: IBaselineTriggers;
  instructions: string;
  constraints: string[];
  output_requirements: string[];
  quality_criteria: IBaselineCriterion[];
  compatible_with: { agents: string[] };
}

const BASELINE_COUNT = 28;
/** Skills whose prose was edited on purpose after the baseline capture. Only their opening is pinned. */
const EDITED_SINCE_BASELINE = new Set(["plan", "clean-codebase"]);
const EDITED_PREFIX_CHARS = 200;
const RENAMED_IDS: Record<string, string> = {
  security: "audit-security",
  "tdd-methodology": "tdd-workflow",
  upgrade: "upgrade-version",
};

async function loadDogfood() {
  const logger = createNoopEventLogger();
  const loader = new SkillFolderLoader({
    roots: [{
      path: join(REPO_ROOT, ".copilot", "skills"),
      kind: SkillRootKind.DOGFOOD,
      writable: false,
      project: null,
    }],
    pathSecurity: createPathSecurity(),
    logger,
    eventRegistry: new EventRegistry(logger),
  });
  const ctx = testSkillContext();
  return { loaded: await loader.list(ctx), diagnostics: await loader.diagnostics(ctx) };
}

Deno.test("[dogfood] all 28 folders load as active skills with no diagnostics", async () => {
  const { loaded, diagnostics } = await loadDogfood();
  assertEquals(diagnostics.filter((d) => d.severity === "error"), []);
  assertEquals(loaded.length, BASELINE_COUNT);
});

Deno.test("[dogfood] every folder reproduces the generator baseline field for field", async () => {
  const baseline: IBaselineSkill[] = JSON.parse(
    await Deno.readTextFile(join(REPO_ROOT, "tests", "fixtures", "skills", "dogfood_baseline.json")),
  );
  assertEquals(baseline.length, BASELINE_COUNT);
  const { loaded } = await loadDogfood();
  const byName = new Map(loaded.map((entry) => [entry.skill.name, entry.skill]));
  for (const expected of baseline) {
    const skill = byName.get(expected.name);
    if (!skill) throw new Error(`missing dogfood skill ${expected.name}`);
    assertEquals(skill.description, expected.description, expected.name);
    assertEquals(skill.triggers, expected.triggers, expected.name);
    assertEquals(skill.constraints, expected.constraints, expected.name);
    assertEquals(skill.output_requirements, expected.output_requirements, expected.name);
    assertEquals(skill.quality_criteria, expected.quality_criteria, expected.name);
    assertEquals(skill.compatible_with, expected.compatible_with, expected.name);
    if (EDITED_SINCE_BASELINE.has(expected.name)) {
      assertEquals(
        skill.instructions.slice(0, EDITED_PREFIX_CHARS),
        expected.instructions.slice(0, EDITED_PREFIX_CHARS),
        expected.name,
      );
    } else {
      assertEquals(skill.instructions, expected.instructions, expected.name);
    }
    assertEquals(skill.status, "active", expected.name);
    assertEquals(skill.skill_id, RENAMED_IDS[expected.skill_id] ?? expected.skill_id, expected.name);
  }
});
