/**
 * @module CriticalSkillCoverageTest
 * @path tests/eval/critical_skill_coverage_test.ts
 * @description Phase 142 Step 17 — asserts every output-contract skill carries
 *   `critical: true` in its `exaix.yaml` sidecar, as loaded through the production folder loader.
 *
 *   `critical` is the compaction guarantee: `renderCriticalSkillsSection` emits a
 *   `REQUIRED SKILLS & CONTRACT` block that AgentRunner inserts with
 *   `nonCompactable: true`, so flagged skills survive context-budget pressure. Only 2 of 27
 *   skills carried the flag, which meant an agent role holding just a specialised contract
 *   variant — the four analysis agent roles, quality-judge, voting-judge — had NO
 *   compaction-protected contract at all: exactly the failure the flag exists to prevent,
 *   on the agent roles whose output format matters most.
 * @architectural-layer Test
 * @dependencies [packages/core/src/func/prompt_formatter.ts, @exaix/testing]
 * @related-files [packages/execution/src/agent_runner.ts, packages/core/src/func/prompt_formatter.ts]
 */
import { assertEquals } from "@std/assert";
import { loadRepoSkillCatalog } from "@exaix/testing";

// Skills whose content must survive compaction: `response-contract*` defines the mandatory
// response format and per-domain `<content>` templates (dropping one leaves no output contract);
// `verdict-rubric` carries scoring criteria whose loss is a silent correctness loss, not a visible break.
function mustBeCritical(skillId: string): boolean {
  return skillId.startsWith("response-contract") ||
    skillId === "verdict-rubric" ||
    skillId === "memory-extraction-content-policy";
}

interface ISkillRecord {
  skillId: string;
  critical: boolean;
  source: string;
}

async function readRuntimeSkills(): Promise<ISkillRecord[]> {
  return [...(await loadRepoSkillCatalog()).values()].map(({ skill }) => ({
    skillId: skill.skill_id,
    critical: skill.critical === true,
    source: skill.path,
  }));
}

Deno.test("critical_skill_coverage — every output-contract runtime skill is critical", async () => {
  const unflagged = (await readRuntimeSkills())
    .filter((s) => mustBeCritical(s.skillId) && !s.critical)
    .map((s) => s.source);
  assertEquals(
    unflagged.sort(),
    [],
    `output-contract skills missing \`critical: true\` — they would be dropped under context pressure:\n${
      unflagged.join("\n")
    }`,
  );
});

Deno.test("critical_skill_coverage — the flag stays deliberate, not universal", async () => {
  // A flag set on everything protects nothing: the non-compactable segment would hold the
  // entire catalog and defeat the budget it exists to work within.
  const runtime = await readRuntimeSkills();
  const critical = runtime.filter((s) => s.critical);
  assertEquals(
    critical.every((s) => mustBeCritical(s.skillId)),
    true,
    `skills flagged critical outside the output-contract family: ${
      critical.filter((s) => !mustBeCritical(s.skillId)).map((s) => s.skillId).join(", ")
    }`,
  );
});
