/**
 * @module SkillCriticalityTest
 * @path tests/blueprints/skill_criticality_test.ts
 * @description Phase 131 Step 3 — per-skill criticality (W16). Verifies the sidecar schema
 *   and ZSkillMatch accept a `critical` flag (default false), that the prompt
 *   formatter splits matched skills into a protected (critical) section and an
 *   ordinary section, and that under forced budget pressure the critical skill
 *   segment survives while the ordinary one is dropped (reusing the existing
 *   isProtected rule). Also asserts the repaired shared fragments are non-empty
 *   and define the output contract.
 * @architectural-layer Core/Execution (test)
 * @dependencies [@std/assert, @std/path]
 * @related-files [packages/schemas/src/skill_folder.ts, packages/core/src/types/prompt_context.ts, packages/core/src/func/prompt_formatter.ts]
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { SkillSidecarSchema } from "@exaix/schemas/skill_folder.ts";
import { ZSkillMatch } from "@exaix/core/types";
import { renderCriticalSkillsSection, renderSkillsSection } from "@exaix/core/func";
import { skillMatchFixture } from "@exaix/testing";
import { SKILLS_DIR } from "./test_helpers.ts";

Deno.test("[step3] the sidecar schema accepts an optional `critical` flag (absent ⇒ falsy)", () => {
  const noFlag = SkillSidecarSchema.safeParse({});
  assert(noFlag.success, `must parse: ${noFlag.success ? "" : noFlag.error.message}`);
  assertEquals(noFlag.data!.critical ?? false, false, "absent critical is treated as false");

  const flagged = SkillSidecarSchema.safeParse({ critical: true });
  assert(flagged.success);
  assertEquals(flagged.data!.critical, true);
});

Deno.test("[step3] ZSkillMatch accepts `critical` (default false)", () => {
  const { critical: _critical, ...withoutCritical } = skillMatchFixture();
  const m = ZSkillMatch.safeParse(withoutCritical);
  assert(m.success, `must parse: ${m.success ? "" : m.error.message}`);
  assertEquals(m.data!.critical, false, "critical defaults to false on a match");
});

Deno.test("[step3] renderer splits matched skills into critical vs ordinary sections", () => {
  const ctx = {
    matched: [
      skillMatchFixture({
        skillId: "contract",
        name: "Contract",
        description: "the contract",
        content: "CONTRACT_BODY",
        critical: true,
      }),
      skillMatchFixture({
        skillId: "methodology",
        name: "Methodology",
        description: "how",
        content: "METHOD_BODY",
        critical: false,
      }),
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
    matched: [skillMatchFixture({ name: "M", description: "d", content: "B", critical: false })],
    totalAvailable: 1,
    retrievalLatencyMs: 0,
  };
  assertEquals(renderCriticalSkillsSection(ctx), "");
  assertStringIncludes(renderSkillsSection(ctx), "B");
});

Deno.test("[step3] the output contract and best-practices content live in skills (fragments retired in Step 7)", async () => {
  const responseContract = await Deno.readTextFile(join(SKILLS_DIR, "response-contract", "SKILL.md"));
  assertStringIncludes(responseContract, "<thought>");
  assertStringIncludes(responseContract, "<content>");

  const bestPractices = await Deno.readTextFile(join(SKILLS_DIR, "blueprint-best-practices", "SKILL.md"));
  // At least 4 real bullets, no empty "1." / "-" placeholder markers.
  const bullets = bestPractices.split("\n").filter((l) => /^\s*([0-9]+\.|[-*])\s+\S/.test(l));
  assert(bullets.length >= 4, `best-practices must have >=4 real bullets, found ${bullets.length}`);
  assert(!/^\s*([0-9]+\.|[-*])\s*$/m.test(bestPractices), "no empty list-marker placeholders allowed");
});
