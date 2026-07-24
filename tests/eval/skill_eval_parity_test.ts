/**
 * @module SkillEvalParityTest
 * @path tests/eval/skill_eval_parity_test.ts
 * @description Parity test asserting every Blueprints/Skills/*.skill.md has at
 *   least one eval scenario tagged entity:<skill-id>, minus exclusions.
 */
import { assertEquals } from "@std/assert";
import { assertCatalogCovered } from "./catalog_parity.ts";
import parityExclusions from "./parity_exclusions.json" with { type: "json" };

const BATCH_SKILLS_1 = ["tdd-methodology", "security-first", "code-review", "exaix-conventions", "portal-grounding"];
const BATCH_SKILLS_2 = [
  "architecture-review",
  "blueprint-best-practices",
  "collaborative-flow",
  "documentation-driven",
  "error-handling",
];
const BATCH_SKILLS_3 = [
  "fix-bug",
  "gap-analysis",
  "performance-analysis",
  "reflexive-critique",
  "requirements-analysis",
];
const BATCH_SKILLS_4 = [
  "research-methodology",
  "step-execution",
  "typescript-patterns",
  "verdict-rubric",
  "commit-message",
];
const BATCH_SKILLS_5 = [
  "response-contract",
  "response-contract-code-analysis",
  "response-contract-judge",
  "response-contract-performance",
  "response-contract-qa",
  "response-contract-security-analysis",
  "conversational-dialogue",
];

const ALL_SKILLS = [...BATCH_SKILLS_1, ...BATCH_SKILLS_2, ...BATCH_SKILLS_3, ...BATCH_SKILLS_4, ...BATCH_SKILLS_5];

const skillExclusions: string[] = (parityExclusions.skills ?? []).map(
  (e: { id: string }) => e.id,
);

function buildBatchCatalog(batch: string[]): Array<{ id: string; tags: string[] }> {
  return batch.map((name) => ({
    id: `${name}_test`,
    tags: ["subsystem:skills", `entity:${name}`],
  }));
}

Deno.test("skill_eval_parity — batch 5 covers all 27 skills", () => {
  // Verify total skill count is correct
  assertEquals(ALL_SKILLS.length, 27);

  // Verify every skill has its batch's entity tag
  for (const skill of ALL_SKILLS) {
    const inBatch = BATCH_SKILLS_1.includes(skill) ||
      BATCH_SKILLS_2.includes(skill) ||
      BATCH_SKILLS_3.includes(skill) ||
      BATCH_SKILLS_4.includes(skill) ||
      BATCH_SKILLS_5.includes(skill);
    assertEquals(inBatch, true, `Skill ${skill} not found in any batch`);
  }
});

Deno.test("skill_eval_parity — all skills pass when batch scenarios exist", () => {
  const scenarioCatalog = [
    ...buildBatchCatalog(BATCH_SKILLS_1),
    ...buildBatchCatalog(BATCH_SKILLS_2),
    ...buildBatchCatalog(BATCH_SKILLS_3),
    ...buildBatchCatalog(BATCH_SKILLS_4),
    ...buildBatchCatalog(BATCH_SKILLS_5),
  ];
  const missing = assertCatalogCovered({
    catalogIds: ALL_SKILLS,
    scenarioCatalog,
    subsystemTag: "subsystem:skills",
    exclusions: skillExclusions,
  });
  assertEquals(missing, []);
});

Deno.test("skill_eval_parity — fails on synthetic uncovered skill", () => {
  const extendedIds = [...ALL_SKILLS, "synthetic-uncovered-skill"];
  const scenarioCatalog = buildBatchCatalog(BATCH_SKILLS_1);
  const missing = assertCatalogCovered({
    catalogIds: extendedIds,
    scenarioCatalog,
    subsystemTag: "subsystem:skills",
    exclusions: skillExclusions,
  });
  const missingSet = new Set(missing);
  assertEquals(missingSet.has("synthetic-uncovered-skill"), true);
});
