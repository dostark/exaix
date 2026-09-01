/**
 * @module MemoryExtractionSkillTest
 * @path tests/blueprints/memory_extraction_skill_test.ts
 * @description Phase 147 Step 1 contract tests for the memory-extraction content
 *   policy seed and its generated runtime representation.
 * @architectural-layer Test
 * @dependencies [@std/assert, @std/yaml, @exaix/schemas]
 * @related-files [scripts/build_skills_index.ts, packages/schemas/src/memory_bank.ts]
 */

import { assert, assertEquals, assertExists, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { parse as parseYaml } from "@std/yaml";
import { type ISkill, SkillSchema } from "@exaix/schemas/memory_bank.ts";
import { REPO_ROOT } from "./test_helpers.ts";

const SKILL_ID = "memory-extraction-content-policy";
const SEED_PATH = join(REPO_ROOT, "Blueprints", "Skills", `${SKILL_ID}.skill.md`);
const RUNTIME_PATH = join(REPO_ROOT, "Memory", "Skills", "global", `${SKILL_ID}.json`);

interface ISkillSeed {
  frontmatter: Omit<ISkill, "instructions">;
  instructions: string;
}

function readSeed(): ISkillSeed {
  const content = Deno.readTextFileSync(SEED_PATH);
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  assert(match, "memory extraction policy must have YAML frontmatter and a markdown body");
  return {
    frontmatter: parseYaml(match[1]) as Omit<ISkill, "instructions">,
    instructions: match[2].trim(),
  };
}

Deno.test("[phase147-step1] memory extraction policy validates and carries the exact curation rubric", () => {
  const seed = readSeed();
  const parsed = SkillSchema.parse({ ...seed.frontmatter, instructions: seed.instructions });

  assertEquals(parsed.skill_id, SKILL_ID);
  assertEquals(parsed.critical, true);
  assertEquals(parsed.triggers.tags, ["memory-extraction", "memory-reflection"]);
  assertExists(parsed.quality_criteria);
  assertEquals(parsed.quality_criteria, [
    {
      name: "non-derivability",
      description: "Not trivially recoverable from portal-knowledge structural analysis",
      weight: 40,
    },
    {
      name: "actionability",
      description: "Captures a pattern, convention, decision rationale, or do/don't an agent can act on",
      weight: 35,
    },
    {
      name: "specificity",
      description: "Ties the learning to concrete portal or project context rather than a generic platitude",
      weight: 25,
    },
  ]);
  assertEquals(parsed.quality_criteria.reduce((sum, criterion) => sum + criterion.weight, 0), 100);
});

Deno.test("[phase147-step1] instructions distinguish non-derivable knowledge from structural facts", () => {
  const { instructions } = readSeed();

  assertStringIncludes(instructions, "Repository Pattern");
  assertStringIncludes(instructions, "why");
  assertStringIncludes(instructions, "File A imports File B");
  assertStringIncludes(instructions, "query_relationships");
  assertStringIncludes(instructions, "who_depends_on");
  assertStringIncludes(instructions.toLowerCase(), "deprioritize");
});

Deno.test("[phase147-step1] generated runtime policy is schema-valid and matches the authored body", () => {
  const seed = readSeed();
  const runtime = SkillSchema.parse(JSON.parse(Deno.readTextFileSync(RUNTIME_PATH)));

  assertEquals(runtime.skill_id, SKILL_ID);
  assertEquals(runtime.instructions, seed.instructions);
  assertEquals(
    runtime.quality_criteria,
    SkillSchema.parse({
      ...seed.frontmatter,
      instructions: seed.instructions,
    }).quality_criteria,
  );
});
