/**
 * @module SkillContentQualityTest
 * @path tests/blueprints/skill_content_quality_test.ts
 * @description Phase 131 Step 5 — deep skill-content quality (W18). Every curated
 *   skill must have a non-trivial instructions body, at least one constraint and
 *   one quality criterion, no two skills may share an identical instruction block,
 *   the thin portal-grounding skill is expanded, and the retired exaix-conventions
 *   skill has no file and no agent reference.
 * @architectural-layer Skill (test)
 * @dependencies [@std/assert, @std/path, @exaix/testing]
 * @related-files [packages/schemas/src/memory_bank.ts, packages/core/src/skills/skill_folder_loader.ts]
 */

import { assert } from "@std/assert";
import { join } from "@std/path";
import type { ISkillQualityCriterion } from "@exaix/schemas/memory_bank.ts";
import { loadRepoSkillCatalog } from "@exaix/testing";
import { AGENTS_DIR } from "./test_helpers.ts";

interface ISkillFile {
  id: string;
  constraints: string[];
  qualityCriteria: ISkillQualityCriterion[];
  body: string;
}

async function loadSkills(): Promise<ISkillFile[]> {
  return [...(await loadRepoSkillCatalog()).values()].map(({ skill }) => ({
    id: skill.skill_id,
    constraints: skill.constraints ?? [],
    qualityCriteria: skill.quality_criteria ?? [],
    body: skill.instructions,
  }));
}

Deno.test("[step5] every skill has a substantive body, >=1 constraint and >=1 quality criterion", async () => {
  for (const s of await loadSkills()) {
    const bodyLines = s.body.split("\n").filter((l) => l.trim()).length;
    assert(bodyLines >= 12, `${s.id}: instructions body too thin (${bodyLines} non-blank lines)`);
    assert(
      s.constraints.length >= 1,
      `${s.id}: needs >=1 constraint`,
    );
    assert(
      s.qualityCriteria.length >= 1,
      `${s.id}: needs >=1 quality_criterion`,
    );
  }
});

Deno.test("[step5] no two skills share an identical instructions body (no duplicate blocks)", async () => {
  const skills = await loadSkills();
  const seen = new Map<string, string>();
  for (const s of skills) {
    const norm = s.body.replace(/\s+/g, " ").trim();
    const prev = seen.get(norm);
    assert(prev === undefined, `${s.id} duplicates the instructions of ${prev}`);
    seen.set(norm, s.id);
  }
});

Deno.test("[step5] portal-grounding (the most-referenced skill) is expanded, not a stub", async () => {
  const s = (await loadSkills()).find((x) => x.id === "portal-grounding")!;
  const bodyLines = s.body.split("\n").filter((l) => l.trim()).length;
  assert(bodyLines >= 25, `portal-grounding still thin (${bodyLines} lines)`);
});

Deno.test("[step5] exaix-conventions is retired: no skill file and no agent bundles it", async () => {
  assert(
    !(await loadSkills()).some((s) => s.id === "exaix-conventions"),
    "exaix-conventions is Exaix dev guidance owned by .copilot/skills/exaix-development; the runtime skill file must be removed",
  );
  for (const entry of Deno.readDirSync(AGENTS_DIR)) {
    if (!entry.isFile || !entry.name.endsWith(".md")) continue;
    const content = Deno.readTextFileSync(join(AGENTS_DIR, entry.name));
    assert(
      !content.includes("exaix-conventions"),
      `${entry.name} still references the retired exaix-conventions skill`,
    );
  }
});
