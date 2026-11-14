/**
 * @module OutputContractSelectionTest
 * @path tests/agents/output_contract_selection_test.ts
 * @description Verifies through the production skills service that request wording never selects a response-contract skill.
 * @architectural-layer Test
 * @related-files [packages/core/src/skills/output_contract.ts, packages/core/src/skills/skills.ts]
 */
import { assertEquals } from "@std/assert";
import { OUTPUT_CONTRACT_SKILL } from "@exaix/core/skills";
import { createRealSkillsService } from "./helpers/real_skills_service.ts";

const CONTRACT_SKILLS = new Set(Object.values(OUTPUT_CONTRACT_SKILL));

const WORDINGS = [
  { keywords: ["security", "vulnerability", "security review"], taskType: "security" },
  { keywords: ["analyze", "analysis", "codebase structure"], taskType: "analysis" },
  { keywords: ["performance", "optimization", "scalability"], taskType: "performance" },
  { keywords: ["qa", "test plan", "testing strategy"], taskType: "qa" },
  { keywords: ["evaluate", "judge", "verdict", "score", "rubric"], taskType: "review" },
];

Deno.test("fix(skills): request wording never selects a response-contract skill", async () => {
  const { service, cleanup } = await createRealSkillsService();
  try {
    for (const wording of WORDINGS) {
      const result = await service.matchSkills({
        keywords: wording.keywords,
        taskType: wording.taskType,
        requestText: wording.keywords.join(" "),
      });
      const selected = result.matches.map((match) => match.skillId).filter((id) => CONTRACT_SKILLS.has(id));
      assertEquals(selected, [], `wording "${wording.keywords[0]}" selected a contract skill`);
    }
  } finally {
    await cleanup();
  }
});
