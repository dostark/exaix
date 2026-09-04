/**
 * @module ScenarioFrameworkSkillValueDecisionTest
 * @path tests/scenario_framework/tests/unit/skill_value_decision_test.ts
 * @description Tests for Phase 158 Step 4's per-skill decision recording: every skill
 * whose value report row reads no-effect must carry a recorded decision (keep with
 * rationale, revise, or remove) — an unrecorded no-effect result is a gap, not a silent
 * default, per the plan's Success Criteria. Scoped to skills specifically; Step 7 owns
 * the cross-artefact (agent_role + skill + flow) coverage check.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/skill_value_decision.ts, tests/scenario_framework/runner/skill_value_report.ts]
 */

import { assertThrows } from "@std/assert";
import { assertSkillDecisionsRecorded, SkillValueDecisionKind } from "../../runner/skill_value_decision.ts";
import type { ISkillValueDecision } from "../../runner/skill_value_decision.ts";
import type { ISkillValueReport } from "../../runner/skill_value_report.ts";

function report(rows: ISkillValueReport["rows"]): ISkillValueReport {
  return { rows, nonCoverage: [] };
}

Deno.test("[SkillValueDecision] a no-effect skill with a recorded decision passes", () => {
  const rows: ISkillValueReport["rows"] = [
    { skillId: "flat-skill", meanDelta: 0, stdevDelta: 0.01, valuePerToken: 0, noEffect: true },
  ];
  const decisions: ISkillValueDecision[] = [
    { skillId: "flat-skill", decision: SkillValueDecisionKind.KEEP, rationale: "structural skill, no quality claim" },
  ];
  assertSkillDecisionsRecorded(report(rows), decisions);
});

Deno.test("[SkillValueDecision] a no-effect skill with no recorded decision is rejected, naming the skill", () => {
  const rows: ISkillValueReport["rows"] = [
    { skillId: "flat-skill", meanDelta: 0, stdevDelta: 0.01, valuePerToken: 0, noEffect: true },
  ];
  assertThrows(() => assertSkillDecisionsRecorded(report(rows), []), Error, "flat-skill");
});

Deno.test("[SkillValueDecision] a skill with a real effect needs no decision", () => {
  const rows: ISkillValueReport["rows"] = [
    { skillId: "effective-skill", meanDelta: 0.3, stdevDelta: 0.02, valuePerToken: 1.5, noEffect: false },
  ];
  assertSkillDecisionsRecorded(report(rows), []);
});

Deno.test("[SkillValueDecision] a decision for the wrong skill id does not satisfy a different no-effect skill", () => {
  const rows: ISkillValueReport["rows"] = [
    { skillId: "flat-skill", meanDelta: 0, stdevDelta: 0.01, valuePerToken: 0, noEffect: true },
  ];
  const decisions: ISkillValueDecision[] = [
    { skillId: "other-skill", decision: SkillValueDecisionKind.KEEP, rationale: "n/a" },
  ];
  assertThrows(() => assertSkillDecisionsRecorded(report(rows), decisions), Error, "flat-skill");
});

Deno.test("[SkillValueDecision] a decision with an empty rationale is rejected", () => {
  const rows: ISkillValueReport["rows"] = [
    { skillId: "flat-skill", meanDelta: 0, stdevDelta: 0.01, valuePerToken: 0, noEffect: true },
  ];
  const decisions: ISkillValueDecision[] = [
    { skillId: "flat-skill", decision: SkillValueDecisionKind.REMOVE, rationale: "" },
  ];
  assertThrows(() => assertSkillDecisionsRecorded(report(rows), decisions), Error, "rationale");
});
