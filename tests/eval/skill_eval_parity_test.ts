/**
 * @module SkillEvalParityTest
 * @path tests/eval/skill_eval_parity_test.ts
 * @description Parity test asserting every Blueprints/Skills/*.skill.md has at
 *   least one eval scenario tagged entity:<skill-id>, minus exclusions.
 */
import { assertEquals } from "@std/assert";
import { dirname, fromFileUrl, join, resolve } from "@std/path";
import { assertCatalogCovered } from "./catalog_parity.ts";
import parityExclusions from "./parity_exclusions.json" with { type: "json" };

const REPO_ROOT = resolve(dirname(fromFileUrl(import.meta.url)), "..", "..");
const SEEDS_DIR = join(REPO_ROOT, "Blueprints", "Skills");

/** Every skill id that actually ships, read from the seed catalog rather than restated here. */
async function readShippedSkillIds(): Promise<string[]> {
  const ids: string[] = [];
  for await (const entry of Deno.readDir(SEEDS_DIR)) {
    if (entry.isFile && entry.name.endsWith(".skill.md")) ids.push(entry.name.replace(/\.skill\.md$/, ""));
  }
  return ids.sort();
}

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

Deno.test("skill_eval_parity — the batches cover every skill that ships", async () => {
  // This asserted `ALL_SKILLS.length === 27` against a list declared in this same file, so it
  // could only fail if someone edited the list and forgot to edit the number — while a skill
  // added to `Blueprints/Skills/` and to no batch left the catalog uncovered and the test
  // green. Both halves are now checked against the shipped catalog, which is the thing parity
  // is supposed to be parity WITH; the count is whatever the catalog says it is.
  const shipped = await readShippedSkillIds();
  const batched = new Set(ALL_SKILLS);

  const uncovered = shipped.filter((id) => !batched.has(id));
  assertEquals(uncovered, [], `skills that ship but belong to no batch: ${uncovered.join(", ")}`);

  const stale = ALL_SKILLS.filter((id) => !shipped.includes(id));
  assertEquals(stale, [], `batched skills with no seed in Blueprints/Skills: ${stale.join(", ")}`);
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
