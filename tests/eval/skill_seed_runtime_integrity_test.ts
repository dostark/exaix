/**
 * @module SkillSeedRuntimeIntegrityTest
 * @path tests/eval/skill_seed_runtime_integrity_test.ts
 * @description Asserts every Blueprints/Skills/*.skill.md has a schema-valid
 *   Memory/Skills/global/*.json runtime counterpart.
 */
import { assertEquals } from "@std/assert";
import { walk } from "@std/fs";
import { join, resolve } from "@std/path";
import parityExclusions from "./parity_exclusions.json" with { type: "json" };

const BLUEPRINTS_SKILLS = resolve(Deno.cwd(), "Blueprints", "Skills");
const MEMORY_SKILLS_GLOBAL = resolve(Deno.cwd(), "Memory", "Skills", "global");

/**
 * Skills with no runtime JSON, by design.
 *
 * Reads `skills_without_runtime_json`, not `skills`. The two lists were one until Phase 142: a
 * single `skills` array served both this integrity check and the eval-coverage parity gate, whose
 * concerns are unrelated — a meta-skill can lack a runtime JSON while being perfectly well covered
 * by an eval scenario. Sharing the list meant giving one of the two gates the wrong answer, and
 * the entries' own reason text ("no standalone runtime JSON") described only this one.
 */
const skipSkills: string[] = (parityExclusions.skills_without_runtime_json ?? []).map(
  (e: { id: string }) => e.id,
);

Deno.test("skill_seed_runtime_integrity — every seed skill has a runtime counterpart", async () => {
  const seedFiles: string[] = [];
  for await (const entry of walk(BLUEPRINTS_SKILLS, { includeDirs: false })) {
    if (entry.isFile && entry.name.endsWith(".skill.md")) {
      seedFiles.push(entry.path);
    }
  }

  const missing: string[] = [];
  for (const seedPath of seedFiles) {
    const skillId = seedPath.split("/").pop()?.replace(/\.skill\.md$/, "");
    if (!skillId) continue;
    if (skipSkills.includes(skillId)) continue;

    const runtimePath = join(MEMORY_SKILLS_GLOBAL, `${skillId}.json`);
    try {
      const runtimeContent = await Deno.readTextFile(runtimePath);
      const runtimeJson = JSON.parse(runtimeContent);
      if (!runtimeJson || typeof runtimeJson !== "object") {
        missing.push(`${skillId}: runtime JSON is not an object`);
      }
    } catch {
      missing.push(`${skillId}: missing runtime JSON`);
    }
  }

  assertEquals(missing, [], `Seed↔runtime integrity failures:\n  ${missing.join("\n  ")}`);
});
