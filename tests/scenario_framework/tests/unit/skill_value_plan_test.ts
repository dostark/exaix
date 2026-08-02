/**
 * @module ScenarioFrameworkSkillValuePlanTest
 * @path tests/scenario_framework/tests/unit/skill_value_plan_test.ts
 * @description Tests for Phase 158 Step 4's full-trial planning: screening results are
 * ranked by absolute delta, and every skill flagged `critical` (ISkill.critical, Phase
 * 131 W16's protected-prompt-segment flag — reused here as "this skill's value claim is
 * load-bearing" per the plan's own wording) is guaranteed a full trial even if it did not
 * rank into the top N, since a skill whose absence would be silently protected from
 * context-budget compaction is exactly the kind of skill a broken value claim would hide.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/skill_value_plan.ts, tests/scenario_framework/runner/arm_comparison.ts]
 */

import { assertEquals } from "@std/assert";
import { planFullTrials } from "../../runner/skill_value_plan.ts";
import type { IScreeningResult } from "../../runner/skill_value_plan.ts";
import { computePairedComparison } from "../../runner/arm_comparison.ts";
import { ComparisonMetric } from "../../runner/arm_comparison.ts";

function screeningResult(skillId: string, delta: number): IScreeningResult {
  return {
    skillId,
    comparison: computePairedComparison({
      armId: skillId,
      metric: ComparisonMetric.JUDGE_SCORE,
      tasks: [{ taskId: "screen-task", control: [0.5], treatment: [0.5 + delta] }],
    }),
  };
}

Deno.test("[SkillValuePlan] the top N screening results by absolute delta are selected, tagged ranked", () => {
  const screening = [
    screeningResult("skill-a", 0.1),
    screeningResult("skill-b", -0.4),
    screeningResult("skill-c", 0.2),
  ];
  const plan = planFullTrials(screening, new Set(), 2);
  assertEquals(plan.map((c) => c.skillId), ["skill-b", "skill-c"]);
  assertEquals(plan.every((c) => c.reason === "ranked"), true);
});

Deno.test("[SkillValuePlan] a critical skill outside the top N is added, tagged critical", () => {
  const screening = [
    screeningResult("skill-a", 0.1),
    screeningResult("skill-b", -0.4),
    screeningResult("skill-critical", 0.01),
  ];
  const plan = planFullTrials(screening, new Set(["skill-critical"]), 1);
  assertEquals(plan.map((c) => c.skillId).sort(), ["skill-b", "skill-critical"]);
  assertEquals(plan.find((c) => c.skillId === "skill-critical")?.reason, "critical");
  assertEquals(plan.find((c) => c.skillId === "skill-b")?.reason, "ranked");
});

Deno.test("[SkillValuePlan] a critical skill that already ranks into the top N is not duplicated", () => {
  const screening = [screeningResult("skill-a", 0.1), screeningResult("skill-critical", 0.9)];
  const plan = planFullTrials(screening, new Set(["skill-critical"]), 1);
  assertEquals(plan.length, 1);
  assertEquals(plan[0].skillId, "skill-critical");
  assertEquals(plan[0].reason, "ranked");
});

Deno.test("[SkillValuePlan] a critical skill with no screening result at all is still included", () => {
  // A skill that screening never reached (e.g. corpus-reachable only via a task subset
  // that excluded it) is still load-bearing if flagged critical — full trials must not
  // silently skip it just because screening produced no candidate row for it.
  const screening = [screeningResult("skill-a", 0.1)];
  const plan = planFullTrials(screening, new Set(["skill-critical-unscreened"]), 1);
  assertEquals(plan.find((c) => c.skillId === "skill-critical-unscreened")?.reason, "critical");
});

Deno.test("[SkillValuePlan] an empty screening set with no critical skills produces an empty plan", () => {
  assertEquals(planFullTrials([], new Set(), 5), []);
});
