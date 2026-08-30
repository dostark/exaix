/**
 * @module ScenarioFrameworkSkillValuePlan
 * @path tests/scenario_framework/runner/skill_value_plan.ts
 * @description Phase 158 Step 4's full-trial planning: screening results are ranked by
 * absolute delta and the top N are promoted to full trials, and every skill flagged
 * `critical` is guaranteed a full trial even without a screening result or a top-N rank,
 * since a skill whose value claim is load-bearing cannot be silently skipped because it
 * screened as small or was never screened at all. Pure computation only, matching
 * arm_comparison.ts's pattern — running the screening trials themselves is the caller's
 * concern.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/tests/unit/skill_value_plan_test.ts, tests/scenario_framework/runner/arm_comparison.ts]
 */

import type { IPairedComparisonResult } from "./arm_comparison.ts";

export interface IScreeningResult {
  skillId: string;
  comparison: IPairedComparisonResult;
}

export type FullTrialReason = "ranked" | "critical";

export interface IFullTrialCandidate {
  skillId: string;
  reason: FullTrialReason;
}

/**
 * Ranks screening results by absolute mean delta and takes the top N as "ranked"; every critical skill id not already selected is appended as "critical" regardless of screening.
 */
export function planFullTrials(
  screening: IScreeningResult[],
  criticalSkillIds: Set<string>,
  topN: number,
): IFullTrialCandidate[] {
  const ranked = [...screening]
    .sort((a, b) => Math.abs(b.comparison.meanDelta) - Math.abs(a.comparison.meanDelta))
    .slice(0, topN)
    .map((result): IFullTrialCandidate => ({ skillId: result.skillId, reason: "ranked" }));

  const selected = new Set(ranked.map((candidate) => candidate.skillId));
  const criticalAdditions: IFullTrialCandidate[] = [...criticalSkillIds]
    .filter((skillId) => !selected.has(skillId))
    .map((skillId) => ({ skillId, reason: "critical" }));

  return [...ranked, ...criticalAdditions];
}
