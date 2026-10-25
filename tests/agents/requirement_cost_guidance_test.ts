/**
 * @module RequirementCostGuidanceTest
 * @path tests/agents/requirement_cost_guidance_test.ts
 * @description Regression coverage for the requirement-cost check, the configuration-only
 * alternative, and scope escalation across the phase-loop skills.
 */

import { assert } from "@std/assert";

const SKILLS = ".copilot/skills";

async function skill(name: string): Promise<string> {
  return await Deno.readTextFile(`${SKILLS}/${name}/SKILL.md`);
}

Deno.test("Agent docs: plan prices requirements that force runtime code", async () => {
  const md = await skill("plan");
  assert(md.includes("#### J. Requirement cost and the configuration-only alternative (§2J)"), "§2J is missing");
  assert(md.includes("Requirement Cost table"), "the cost table rule is missing");
  assert(md.includes("independent in both directions"), "the two-way tool independence rule is missing");
  assert(md.includes("Price every requirement that forces runtime code (§2J)"), "the Do bullet is missing");
});

Deno.test("Agent docs: reviews offer narrowing a requirement beside each new defense", async () => {
  const plan = await skill("review-phase-plan");
  assert(plan.includes("**Requirement-cost check** (plan §2J)"), "review-phase-plan Phase 2 check is missing");
  assert(plan.includes("narrowing or dropping the requirement"), "review-phase-plan two-option rule is missing");
  const code = await skill("review-phase-code");
  assert(code.includes("**Defense-layer accumulation.**"), "review-phase-code accumulation rule is missing");
});

Deno.test("Agent docs: remediation escalates scope instead of growing it", async () => {
  for (const name of ["remediate-plan-gaps", "remediate-code-gaps"]) {
    const md = await skill(name);
    assert(md.includes("Escalate scope instead of growing it"), `${name} escalation rule is missing`);
    assert(md.includes("never drop the requirement silently"), `${name} silent-drop guard is missing`);
  }
});

Deno.test("Agent docs: branch-into-branch integration stays linear", async () => {
  const md = await skill("commit");
  assert(
    md.includes("Integrate a branch into another feature branch the same way"),
    "linear integration rule is missing",
  );
});
