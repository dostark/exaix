/**
 * @module MemoryExtractionSkillTest
 * @path tests/blueprints/memory_extraction_skill_test.ts
 * @description Phase 147 Step 1 contract tests for the memory-extraction content
 *   policy skill folder, as loaded through the production folder loader.
 * @architectural-layer Test
 * @dependencies [@std/assert, @exaix/testing]
 * @related-files [packages/schemas/src/skill_folder.ts, packages/core/src/skills/skill_folder_loader.ts]
 */

import { assert, assertEquals, assertExists, assertStringIncludes } from "@std/assert";
import { loadRepoSkillCatalog } from "@exaix/testing";

const SKILL_ID = "memory-extraction-content-policy";

async function readPolicy() {
  const loaded = (await loadRepoSkillCatalog()).get(SKILL_ID);
  assert(loaded, "memory extraction policy must load as a valid skill folder");
  return loaded.skill;
}

Deno.test("[phase147-step1] memory extraction policy validates and carries the exact curation rubric", async () => {
  const parsed = await readPolicy();

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

Deno.test("[phase147-step1] instructions distinguish non-derivable knowledge from structural facts", async () => {
  const { instructions } = await readPolicy();

  assertStringIncludes(instructions, "Repository Pattern");
  assertStringIncludes(instructions, "why");
  assertStringIncludes(instructions, "File A imports File B");
  assertStringIncludes(instructions, "query_relationships");
  assertStringIncludes(instructions, "find_dependents");
  assertStringIncludes(instructions.toLowerCase(), "deprioritize");
});
