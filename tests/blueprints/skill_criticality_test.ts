/**
 * @module SkillCriticalityTest
 * @path tests/blueprints/skill_criticality_test.ts
 * @description Phase 131 Step 3 — per-skill criticality (W16). Verifies SkillSchema
 *   and ZSkillMatch accept a `critical` flag (default false), that the prompt
 *   formatter splits matched skills into a protected (critical) section and an
 *   ordinary section, and that under forced budget pressure the critical skill
 *   segment survives while the ordinary one is dropped (reusing the existing
 *   isProtected rule). Also asserts the repaired shared fragments are non-empty
 *   and define the output contract.
 * @architectural-layer Core/Execution (test)
 * @dependencies [@std/assert, @std/path]
 * @related-files [packages/schemas/src/memory_bank.ts, packages/core/src/types/prompt_context.ts, packages/core/src/func/prompt_formatter.ts]
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { SkillSchema } from "@exaix/schemas/memory_bank.ts";
import { MemoryBankSource, MemoryScope, SkillStatus, ZSkillMatch } from "@exaix/core/types";
import { renderCriticalSkillsSection, renderSkillsSection } from "@exaix/core/func";
import { SKILLS_DIR } from "./test_helpers.ts";

function makeSkill(over: Partial<{ id: string; name: string; instructions: string; critical: boolean }>) {
  return {
    id: over.id ?? "11111111-1111-4111-8111-111111111111",
    created_at: "2026-01-01T00:00:00.000Z",
    source: MemoryBankSource.USER,
    scope: MemoryScope.GLOBAL,
    status: SkillStatus.ACTIVE,
    skill_id: "x",
    name: over.name ?? "X",
    version: "1.0.0",
    description: "d",
    triggers: {},
    instructions: over.instructions ?? "do the thing",
    critical: over.critical,
    usage_count: 0,
  };
}

Deno.test("[step3] SkillSchema accepts an optional `critical` flag (absent ⇒ falsy)", () => {
  const noFlag = SkillSchema.safeParse(makeSkill({}));
  assert(noFlag.success, `must parse: ${noFlag.success ? "" : noFlag.error.message}`);
  assertEquals(noFlag.data!.critical ?? false, false, "absent critical is treated as false");

  const flagged = SkillSchema.safeParse(makeSkill({ critical: true }));
  assert(flagged.success);
  assertEquals(flagged.data!.critical, true);
});

Deno.test("[step3] ZSkillMatch accepts `critical` (default false)", () => {
  const m = ZSkillMatch.safeParse({
    skillId: "11111111-1111-4111-8111-111111111111",
    title: "X",
    description: "d",
    content: "c",
    matchScore: 1,
  });
  assert(m.success, `must parse: ${m.success ? "" : m.error.message}`);
  assertEquals(m.data!.critical, false, "critical defaults to false on a match");
});

Deno.test("[step3] renderer splits matched skills into critical vs ordinary sections", () => {
  const ctx = {
    matched: [
      {
        skillId: "1",
        title: "Contract",
        description: "the contract",
        content: "CONTRACT_BODY",
        matchScore: 1,
        tags: [],
        critical: true,
      },
      {
        skillId: "2",
        title: "Methodology",
        description: "how",
        content: "METHOD_BODY",
        matchScore: 1,
        tags: [],
        critical: false,
      },
    ],
    totalAvailable: 2,
    retrievalLatencyMs: 0,
  };

  const critical = renderCriticalSkillsSection(ctx);
  assertStringIncludes(critical, "CONTRACT_BODY");
  assert(!critical.includes("METHOD_BODY"), "critical section must exclude ordinary skills");

  const ordinary = renderSkillsSection(ctx);
  assertStringIncludes(ordinary, "METHOD_BODY");
  assert(!ordinary.includes("CONTRACT_BODY"), "ordinary section must exclude critical skills");
});

Deno.test("[step3] renderer returns empty critical section when no critical skills", () => {
  const ctx = {
    matched: [{ skillId: "1", title: "M", description: "d", content: "B", matchScore: 1, tags: [], critical: false }],
    totalAvailable: 1,
    retrievalLatencyMs: 0,
  };
  assertEquals(renderCriticalSkillsSection(ctx), "");
  assertStringIncludes(renderSkillsSection(ctx), "B");
});

Deno.test("[step3] the output contract and best-practices content live in skills (fragments retired in Step 7)", async () => {
  // Step 7 retired the shared Fragments; their content was migrated into skills.
  // The output contract now lives in the response-contract skill, and the
  // best-practices guidance in the blueprint-best-practices skill.
  const responseContract = await Deno.readTextFile(join(SKILLS_DIR, "response-contract.skill.md"));
  assertStringIncludes(responseContract, "<thought>");
  assertStringIncludes(responseContract, "<content>");

  const bestPractices = await Deno.readTextFile(join(SKILLS_DIR, "blueprint-best-practices.skill.md"));
  // At least 4 real bullets, no empty "1." / "-" placeholder markers.
  const bullets = bestPractices.split("\n").filter((l) => /^\s*([0-9]+\.|[-*])\s+\S/.test(l));
  assert(bullets.length >= 4, `best-practices must have >=4 real bullets, found ${bullets.length}`);
  assert(!/^\s*([0-9]+\.|[-*])\s*$/m.test(bestPractices), "no empty list-marker placeholders allowed");
});
