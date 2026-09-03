/**
 * @module TestEngineerMigrationTest
 * @path tests/blueprints/test_engineer_migration_test.ts
 * @description Phase 131 Step 4 — vertical slice. Verifies the test-engineer
 *   identity is migrated to the skill model: its methodology lives in
 *   tdd-methodology (not the persona), the output contract is the `critical`
 *   response-contract skill (added to default_skills, fragment includes
 *   retired), and the persona is slimmed to role/scope/voice. Also asserts the
 *   GAP-5 golden fixture exists so the no-regression check has a baseline, and
 *   that the response-contract critical skill renders into the protected
 *   prompt segment.
 * @architectural-layer Blueprint/Skill (test)
 * @dependencies [@std/assert, @std/path]
 * @related-files [packages/schemas/src/memory_bank.ts, packages/core/src/func/prompt_formatter.ts, scripts/build_skills_index.ts]
 */

import { assert, assertExists } from "@std/assert";
import { join, resolve } from "@std/path";
import { SkillSchema } from "@exaix/schemas/memory_bank.ts";
import { renderCriticalSkillsSection } from "@exaix/core/func";

const REPO_ROOT = resolve(new URL("../../", import.meta.url).pathname);
const AGENTS = join(REPO_ROOT, "Blueprints", "Agents");
const SKILLS = join(REPO_ROOT, "Blueprints", "Skills");
const FIXTURES = join(REPO_ROOT, "tests", "fixtures", "identity_migration");

function parseFrontmatter(md: string): { fm: string; body: string } {
  const m = md.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) throw new Error("no frontmatter");
  return { fm: m[1], body: m[2] };
}

Deno.test("[step4][GAP-5] a pre-migration golden fixture exists for test-engineer", async () => {
  const golden = await Deno.readTextFile(join(FIXTURES, "test-engineer.golden.md"));
  // The baseline must capture the original methodology so a regression is detectable.
  assert(golden.includes("Test Pyramid"), "golden must preserve the pre-migration Test Pyramid methodology");
});

Deno.test("[step4] test-engineer persona is slimmed: methodology lives in skills, not the body", async () => {
  const md = await Deno.readTextFile(join(AGENTS, "test-engineer.md"));
  const { fm, body } = parseFrontmatter(md);

  // default_skills carries the contract + methodology.
  assert(fm.includes("response-contract"), "default_skills must include the critical response-contract skill");
  assert(fm.includes("tdd-methodology"), "default_skills must still include tdd-methodology");

  // Methodology has LEFT the persona body.
  assert(!body.includes("Test Pyramid"), "Test Pyramid methodology must move to tdd-methodology skill");
  assert(!body.includes("FIRST Principles"), "FIRST principles must move to the skill");

  // Fragment includes for the contract are retired (contract is now a skill).
  assert(!body.includes("{{include:standard-response-format}}"), "standard-response-format include must be retired");
  assert(!body.includes("{{include:plan-schema-full}}"), "plan-schema-full include must be retired");

  // Persona stays small (role/scope/voice).
  assert(body.split("\n").filter((l) => l.trim()).length <= 20, "slimmed persona should be ~role/scope/voice only");
});

Deno.test("[step4] tdd-methodology skill absorbed the test-engineer methodology", async () => {
  const md = await Deno.readTextFile(join(SKILLS, "tdd-methodology.skill.md"));
  assert(md.includes("Test Pyramid"), "tdd-methodology must now carry the Test Pyramid");
  assert(md.includes("FIRST"), "tdd-methodology must now carry the FIRST principles");
  assert(md.includes("Arrange-Act-Assert") || md.includes("Arrange"), "tdd-methodology must carry the AAA pattern");
});

Deno.test("[step4] response-contract is a valid `critical` skill defining the output contract", async () => {
  const md = await Deno.readTextFile(join(SKILLS, "response-contract.skill.md"));
  const { fm, body } = parseFrontmatter(md);
  assert(fm.includes("critical: true"), "response-contract must be marked critical: true");
  assert(body.includes("<thought>"), "contract must define <thought>");
  assert(body.includes("<content>"), "contract must define <content>");

  // Its generated JSON must validate and be critical.
  const json = JSON.parse(
    await Deno.readTextFile(join(REPO_ROOT, "Memory", "Skills", "global", "response-contract.json")),
  );
  const parsed = SkillSchema.safeParse(json);
  assert(
    parsed.success,
    `generated response-contract JSON must satisfy SkillSchema: ${parsed.success ? "" : parsed.error.message}`,
  );
  assert(parsed.data!.critical === true, "generated response-contract must carry critical: true");
});

Deno.test("[step4] a critical response-contract match renders into the PROTECTED section", () => {
  const ctx = {
    matched: [
      {
        skillId: "1",
        title: "Response Contract",
        description: "the contract",
        content: "CONTRACT",
        matchScore: 1,
        tags: [],
        critical: true,
      },
      {
        skillId: "2",
        title: "TDD",
        description: "tdd",
        content: "METHODOLOGY",
        matchScore: 1,
        tags: [],
        critical: false,
      },
    ],
    totalAvailable: 2,
    retrievalLatencyMs: 0,
  };
  const critical = renderCriticalSkillsSection(ctx);
  assert(critical.includes("CONTRACT"), "contract must render in the protected critical section");
  assert(!critical.includes("METHODOLOGY"), "methodology stays out of the protected section");
  assertExists(critical);
});
