/**
 * @module SkillContentQualityTest
 * @path tests/blueprints/skill_content_quality_test.ts
 * @description Phase 131 Step 5 — deep skill-content quality (W18). Every curated
 *   skill must have a non-trivial instructions body, at least one constraint and
 *   one quality criterion, no two skills may share an identical instruction block,
 *   the thin portal-grounding skill is expanded, and the retired exaix-conventions
 *   skill has no file and no agent reference.
 * @architectural-layer Skill (test)
 * @dependencies [@std/assert, @std/path, @std/yaml]
 * @related-files [packages/schemas/src/memory_bank.ts, scripts/build_skills_index.ts]
 */

import { assert } from "@std/assert";
import { join } from "@std/path";
import { parse as parseYaml } from "@std/yaml";
import { AGENTS_DIR, SKILLS_DIR } from "./test_helpers.ts";

/** YAML-parsed skill frontmatter (structurally permissive — fields are asserted in-test). */
interface ISkillFrontmatter {
  [key: string]: string | number | boolean | null | ISkillFrontmatter | Array<string | ISkillFrontmatter>;
}

interface ISkillFile {
  id: string;
  fm: ISkillFrontmatter;
  body: string;
}

function loadSkills(): ISkillFile[] {
  const out: ISkillFile[] = [];
  for (const e of Deno.readDirSync(SKILLS_DIR)) {
    if (!e.isFile || !e.name.endsWith(".skill.md")) continue;
    const content = Deno.readTextFileSync(join(SKILLS_DIR, e.name));
    const m = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!m) throw new Error(`malformed skill ${e.name}`);
    out.push({
      id: e.name.replace(".skill.md", ""),
      fm: parseYaml(m[1]) as ISkillFrontmatter,
      body: m[2].trim(),
    });
  }
  return out;
}

Deno.test("[step5] every skill has a substantive body, >=1 constraint and >=1 quality criterion", () => {
  for (const s of loadSkills()) {
    const bodyLines = s.body.split("\n").filter((l) => l.trim()).length;
    assert(bodyLines >= 12, `${s.id}: instructions body too thin (${bodyLines} non-blank lines)`);
    assert(
      Array.isArray(s.fm.constraints) && (s.fm.constraints as unknown[]).length >= 1,
      `${s.id}: needs >=1 constraint`,
    );
    assert(
      Array.isArray(s.fm.quality_criteria) && (s.fm.quality_criteria as unknown[]).length >= 1,
      `${s.id}: needs >=1 quality_criterion`,
    );
  }
});

Deno.test("[step5] no two skills share an identical instructions body (no duplicate blocks)", () => {
  const skills = loadSkills();
  const seen = new Map<string, string>();
  for (const s of skills) {
    const norm = s.body.replace(/\s+/g, " ").trim();
    const prev = seen.get(norm);
    assert(prev === undefined, `${s.id} duplicates the instructions of ${prev}`);
    seen.set(norm, s.id);
  }
});

Deno.test("[step5] portal-grounding (the most-referenced skill) is expanded, not a stub", () => {
  const s = loadSkills().find((x) => x.id === "portal-grounding")!;
  const bodyLines = s.body.split("\n").filter((l) => l.trim()).length;
  assert(bodyLines >= 25, `portal-grounding still thin (${bodyLines} lines)`);
});

Deno.test("[step5] exaix-conventions is retired: no skill file and no agent bundles it", () => {
  assert(
    !loadSkills().some((s) => s.id === "exaix-conventions"),
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
