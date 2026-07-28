/**
 * @module SkillSeedRuntimeIntegrityTest
 * @path tests/eval/skill_seed_runtime_integrity_test.ts
 * @architectural-layer Test
 * @description Asserts every `Blueprints/Skills/*.skill.md` has a schema-valid runtime
 *   counterpart under `Memory/Skills/`, with the seed→runtime field mapping intact.
 *
 *   Three things this check is deliberately strict about, each because the loose version of it
 *   shipped first and proved worthless:
 *
 *   1. **Scope-aware.** The runtime catalog has four scopes and two skills ship under
 *      `project/Exaix`. Looking only in `global` made them appear absent, and they were papered
 *      over with an exclusion whose reason ("no standalone runtime JSON") was false.
 *   2. **Schema-validating.** `typeof json === "object"` passes on `{}`. The runtime document is
 *      what `SkillsService` hands to the prompt assembler, so it is validated against the schema
 *      that models it.
 *   3. **Mapping-checked.** A runtime JSON can be schema-valid and still disagree with the seed
 *      it was generated from — a stale regeneration is exactly the drift this check exists to
 *      catch, and it is invisible to both of the above.
 * @dependencies [@exaix/schemas, @std/yaml]
 * @related-files [tests/eval/runtime_skill_scopes.ts, scripts/generate_skill_json.ts]
 */
import { assertEquals } from "@std/assert";
import { walk } from "@std/fs";
import { resolve } from "@std/path";
import { parse as parseYaml } from "@std/yaml";
import { SkillSchema } from "@exaix/schemas";
import parityExclusions from "./parity_exclusions.json" with { type: "json" };
import { type IRuntimeSkillDocument, readRuntimeSkills } from "./runtime_skill_scopes.ts";

const BLUEPRINTS_SKILLS = resolve(Deno.cwd(), "Blueprints", "Skills");
const MEMORY_SKILLS = resolve(Deno.cwd(), "Memory", "Skills");

/**
 * Seed frontmatter fields the generator copies to the runtime document unchanged.
 *
 * `instructions` is asserted separately because it comes from the markdown body rather than the
 * frontmatter, and the managed fields (`id`, `created_at`, `usage_count`, …) are excluded because
 * the generator owns them.
 */
const MAPPED_FIELDS: readonly string[] = [
  "skill_id",
  "name",
  "version",
  "description",
  "scope",
  "status",
  "source",
  "triggers",
  "constraints",
  "output_requirements",
  "quality_criteria",
];

/** Skills exempt from the runtime-counterpart rule. Expected empty — see the module note. */
const skipSkills: string[] = (parityExclusions.skills_without_runtime_json ?? []).map(
  (entry: { id: string }) => entry.id,
);

interface ISeedSkill {
  skillId: string;
  frontmatter: IRuntimeSkillDocument;
  body: string;
}

async function readSeedSkills(): Promise<ISeedSkill[]> {
  const seeds: ISeedSkill[] = [];
  for await (const entry of walk(BLUEPRINTS_SKILLS, { includeDirs: false })) {
    if (!entry.isFile || !entry.name.endsWith(".skill.md")) continue;
    const text = await Deno.readTextFile(entry.path);
    const match = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    seeds.push({
      skillId: entry.name.replace(/\.skill\.md$/, ""),
      frontmatter: match ? parseYaml(match[1]) as IRuntimeSkillDocument : {},
      body: match ? match[2].trim() : "",
    });
  }
  seeds.sort((a, b) => a.skillId.localeCompare(b.skillId));
  return seeds;
}

Deno.test("skill_seed_runtime_integrity — every seed skill has a runtime counterpart in some scope", async () => {
  const runtime = await readRuntimeSkills(MEMORY_SKILLS);
  const missing = (await readSeedSkills())
    .filter((seed) => !skipSkills.includes(seed.skillId) && !runtime.has(seed.skillId))
    .map((seed) => seed.skillId);
  assertEquals(
    missing,
    [],
    `seed skills with no runtime JSON in any scope:\n  ${missing.join("\n  ")}`,
  );
});

Deno.test("skill_seed_runtime_integrity — every runtime skill validates against SkillSchema", async () => {
  const invalid: string[] = [];
  for (const [skillId, document] of await readRuntimeSkills(MEMORY_SKILLS)) {
    const result = SkillSchema.safeParse(document);
    if (!result.success) {
      invalid.push(`${skillId}: ${result.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`);
    }
  }
  assertEquals(invalid.sort(), [], `runtime skills failing SkillSchema:\n  ${invalid.join("\n  ")}`);
});

Deno.test("skill_seed_runtime_integrity — the seed→runtime field mapping is intact", async () => {
  const runtime = await readRuntimeSkills(MEMORY_SKILLS);
  const drift: string[] = [];
  for (const seed of await readSeedSkills()) {
    const document = runtime.get(seed.skillId);
    if (!document) continue; // absence is the first test's finding, not this one's
    for (const field of MAPPED_FIELDS) {
      const seedValue = JSON.stringify(seed.frontmatter[field] ?? null);
      const runtimeValue = JSON.stringify(document[field] ?? null);
      if (seedValue !== runtimeValue) {
        drift.push(`${seed.skillId}.${field}: seed ${seedValue} ≠ runtime ${runtimeValue}`);
      }
    }
    if (String(document.instructions ?? "").trim() !== seed.body) {
      drift.push(`${seed.skillId}.instructions: runtime body differs from the seed's markdown body`);
    }
  }
  assertEquals(
    drift.sort(),
    [],
    `runtime skills that have drifted from their seed — regenerate with scripts/generate_skill_json.ts:\n  ${
      drift.join("\n  ")
    }`,
  );
});

Deno.test("skill_seed_runtime_integrity — no skill needs a runtime-JSON exclusion", () => {
  assertEquals(
    skipSkills,
    [],
    "`skills_without_runtime_json` should be empty: the check is scope-aware, so a skill seeded " +
      "to any scope resolves. An entry here now means a seed skill genuinely has no runtime " +
      `counterpart anywhere, which the first test would also report. Present: ${skipSkills.join(", ")}`,
  );
});
