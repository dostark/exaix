/**
 * @module ScenarioFrameworkSkillValueDecision
 * @path tests/scenario_framework/runner/skill_value_decision.ts
 * @description Phase 158 Step 4's per-skill decision recording: every skill whose value
 * report row reads no-effect must carry a recorded decision — keep with rationale,
 * revise, or remove — so a no-effect result cannot be silently left unaddressed. Scoped
 * to skills specifically; Step 7 owns the cross-artefact (agent_role + skill + flow)
 * coverage check over all measured artefacts.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/tests/unit/skill_value_decision_test.ts, tests/scenario_framework/runner/skill_value_report.ts]
 */

import type { ISkillValueReport } from "./skill_value_report.ts";

export enum SkillValueDecisionKind {
  KEEP = "keep",
  REVISE = "revise",
  REMOVE = "remove",
}

export interface ISkillValueDecision {
  skillId: string;
  decision: SkillValueDecisionKind;
  rationale: string;
}

export function assertSkillDecisionsRecorded(
  report: ISkillValueReport,
  decisions: ISkillValueDecision[],
): void {
  const decisionBySkillId = new Map(decisions.map((decision) => [decision.skillId, decision]));

  for (const row of report.rows) {
    if (!row.noEffect) continue;

    const decision = decisionBySkillId.get(row.skillId);
    if (!decision) {
      throw new Error(
        `Skill "${row.skillId}" measured no effect but has no recorded decision (keep/revise/remove).`,
      );
    }
    if (decision.rationale.trim().length === 0) {
      throw new Error(`Skill "${row.skillId}"'s decision has an empty rationale.`);
    }
  }
}
