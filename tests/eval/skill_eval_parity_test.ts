/**
 * @module SkillEvalParityTest
 * @path tests/eval/skill_eval_parity_test.ts
 * @description Parity test asserting every Blueprints/Skills/*.skill.md has at
 *   least one eval scenario tagged entity:<skill-id>, minus exclusions.
 */
import { assertEquals } from "@std/assert";
import { dirname, fromFileUrl, join, resolve } from "@std/path";
import { assertCatalogCovered } from "./catalog_parity.ts";
import { loadScenarioCatalog } from "../scenario_framework/runner/scenario_catalog.ts";
import parityExclusions from "./parity_exclusions.json" with { type: "json" };

const REPO_ROOT = resolve(dirname(fromFileUrl(import.meta.url)), "..", "..");
const SEEDS_DIR = join(REPO_ROOT, "Blueprints", "Skills");
const FRAMEWORK_HOME = join(REPO_ROOT, "tests", "scenario_framework");

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

Deno.test("skill_eval_parity — every shipped skill has a real scenario, or a reasoned exclusion", async () => {
  // This replaces a check that built its scenario catalog FROM the batch lists — a circle in which
  // adding a skill to a batch also created the scenario that covered it. Measured against the real
  // catalog, the skill scenarios carried **no `entity:` tags at all**, so entity-level coverage for
  // this subsystem was zero while the gate reported green. The tags now come from each scenario's
  // request fixture, which is where the pinned skills are actually declared.
  const catalog = await loadScenarioCatalog({ frameworkHome: FRAMEWORK_HOME });
  const shipped = await readShippedSkillIds();

  const missing = assertCatalogCovered({
    catalogIds: shipped,
    scenarioCatalog: catalog.map((scenario) => ({ id: scenario.id, tags: scenario.tags })),
    subsystemTag: "subsystem:skills",
    exclusions: skillExclusions,
  });

  assertEquals(
    missing.sort(),
    [],
    `these skills ship with no scenario tagged entity:<id> and no reasoned exclusion:\n${missing.join("\n")}`,
  );
});

Deno.test("skill_eval_parity — a scenario's entity tags match the skills its fixture pins", async () => {
  // The tags are only trustworthy if they describe the request that actually runs. A scenario
  // claiming to cover a skill its fixture does not pin would satisfy the gate above while testing
  // nothing about that skill.
  const catalog = await loadScenarioCatalog({ frameworkHome: FRAMEWORK_HOME });
  const mismatched: string[] = [];

  for (const scenario of catalog) {
    if (!scenario.tags.includes("subsystem:skills")) continue;
    const tagged = scenario.tags.filter((tag) => tag.startsWith("entity:")).map((tag) => tag.slice(7));
    if (tagged.length === 0) continue;

    const fixture = join(FRAMEWORK_HOME, scenario.request_fixture);
    const text = await Deno.readTextFile(fixture).catch(() => "");
    const pinned = new Set(
      (text.match(/^skills:\s*\[([\s\S]*?)\]/m)?.[1] ?? "")
        .split(",").map((s) => s.trim()).filter((s) => s.length > 0),
    );

    for (const id of tagged) {
      if (!pinned.has(id)) mismatched.push(`${scenario.id}: entity:${id} is not pinned by its fixture`);
    }
  }

  assertEquals(mismatched.sort(), [], mismatched.join("\n"));
});

// `fails on synthetic uncovered skill` lived here: it fed `assertCatalogCovered` a made-up id and
// checked the helper reported it. That is the helper's own contract, already covered five ways in
// `catalog_parity_harness_test.ts`, and it told us nothing about whether any skill is evaluated.
