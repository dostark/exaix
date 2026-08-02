/**
 * @module ScenarioFrameworkSkillValueReportTest
 * @path tests/scenario_framework/tests/unit/skill_value_report_test.ts
 * @description Tests for Phase 158 Step 4's skill value report: renders delta, variance,
 * token cost (value-per-1k-tokens, reusing Step 1's computeValuePerToken rather than
 * re-deriving it) and the no-effect verdict per skill, plus the non-coverage list with
 * its per-skill reason. This is the plan's explicitly named Planned Test.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/skill_value_report.ts, tests/scenario_framework/runner/arm_comparison.ts, tests/scenario_framework/runner/skill_corpus_reachability.ts]
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { buildSkillValueReport, renderSkillValueReportText } from "../../runner/skill_value_report.ts";
import { computePairedComparison } from "../../runner/arm_comparison.ts";
import { ComparisonMetric } from "../../runner/arm_comparison.ts";

Deno.test("[SkillValueReport] a report row carries delta, stdev, value-per-token and the no-effect verdict", () => {
  const comparison = computePairedComparison({
    armId: "tdd-methodology",
    metric: ComparisonMetric.JUDGE_SCORE,
    tasks: [{ taskId: "task-1", control: [0.5], treatment: [0.7] }],
  });
  const report = buildSkillValueReport(
    [{ skillId: "tdd-methodology", comparison, deltaPromptTokens: 1000 }],
    [],
  );
  assertEquals(report.rows.length, 1);
  const row = report.rows[0];
  assertEquals(row.skillId, "tdd-methodology");
  assertEquals(Math.round(row.meanDelta * 100) / 100, 0.2);
  assertEquals(row.stdevDelta, 0);
  assertEquals(Math.round(row.valuePerToken * 100) / 100, 0.2);
  assertEquals(row.noEffect, false);
});

Deno.test("[SkillValueReport] a zero-token-cost positive delta reports infinite value-per-token, not a crash", () => {
  const comparison = computePairedComparison({
    armId: "free-win-skill",
    metric: ComparisonMetric.JUDGE_SCORE,
    tasks: [{ taskId: "task-1", control: [0.5], treatment: [0.7] }],
  });
  const report = buildSkillValueReport(
    [{ skillId: "free-win-skill", comparison, deltaPromptTokens: 0 }],
    [],
  );
  assertEquals(report.rows[0].valuePerToken, Number.POSITIVE_INFINITY);
});

Deno.test("[SkillValueReport] the non-coverage list is carried through to the report", () => {
  const report = buildSkillValueReport([], [{
    skillId: "orphan-skill",
    reason: "no default_skills entry, no trigger match across 23 corpus tasks",
  }]);
  assertEquals(report.rows.length, 0);
  assertEquals(report.nonCoverage.length, 1);
  assertEquals(report.nonCoverage[0].skillId, "orphan-skill");
});

Deno.test("[SkillValueReport] the rendered text includes the skill id, delta, and no-effect verdict", () => {
  const comparison = computePairedComparison({
    armId: "tdd-methodology",
    metric: ComparisonMetric.JUDGE_SCORE,
    tasks: [{ taskId: "task-1", control: [0.5], treatment: [0.7] }],
  });
  const report = buildSkillValueReport(
    [{ skillId: "tdd-methodology", comparison, deltaPromptTokens: 1000 }],
    [{ skillId: "orphan-skill", reason: "no default_skills entry, no trigger match across 23 corpus tasks" }],
  );
  const text = renderSkillValueReportText(report);
  assertStringIncludes(text, "tdd-methodology");
  assertStringIncludes(text, "0.20");
  assertStringIncludes(text, "orphan-skill");
  assertStringIncludes(text, "no default_skills entry");
});

Deno.test("[SkillValueReport] a no-effect skill is rendered with a NO EFFECT verdict, not a numeric-looking pass", () => {
  const comparison = computePairedComparison({
    armId: "flat-skill",
    metric: ComparisonMetric.JUDGE_SCORE,
    tasks: [
      { taskId: "task-1", control: [0.5], treatment: [0.4] },
      { taskId: "task-2", control: [0.5], treatment: [0.6] },
    ],
  });
  const report = buildSkillValueReport([{ skillId: "flat-skill", comparison, deltaPromptTokens: 500 }], []);
  assertEquals(report.rows[0].noEffect, true);
  const text = renderSkillValueReportText(report);
  assertStringIncludes(text, "NO EFFECT");
});
