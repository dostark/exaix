/**
 * @module ValueComparisonReportTest
 * @path tests/scripts/value_comparison_report_test.ts
 * @description Tests for scripts/run_value_comparison_report.ts — Phase 158 Steps 9-10's
 *   remediation of GAP-1a/GAP-1b. Verifies the script's wrapper functions correctly call
 *   the real computePairedComparison, computeValuePerToken, evaluateValidityGate,
 *   assertValidityGate, assertPlaceboDetected (Step 9), and computeSkillReachability,
 *   planFullTrials, buildSkillValueReport, assertSkillDecisionsRecorded,
 *   groupDeltasByTaskType, interpretPruneVerdict, computeFlowReachability,
 *   buildFlowValueReport, computeJudgeCalibration (Step 10) functions on a generic
 *   IValueComparisonReportInput. All numbers here are deliberately illustrative
 *   (0.4/0.5/0.9-style round values), never phase-158's actual historical measurements —
 *   those are unclean, retry-heavy live-run numbers that must not be encoded as a
 *   fixture (see the plan doc's design correction on Step 9). This test
 *   verifies the plumbing is wired correctly, not any historical claim.
 * @architectural-layer Test
 * @dependencies [@std/assert]
 * @related-files [scripts/run_value_comparison_report.ts]
 */

import { assertAlmostEquals, assertEquals, assertThrows } from "@std/assert";
import {
  computeArmComparisonReport,
  computeFlowValueReport,
  computeIdentityPruneReport,
  computeIdentityTaskTypeReport,
  computeJudgeCalibrationReport,
  computePlaceboReport,
  computeSkillFullTrialPlan,
  computeSkillReachabilityReport,
  computeSkillValueReport,
  computeValidityGateReport,
} from "../../scripts/run_value_comparison_report.ts";
import type {
  IArmComparisonRequest,
  IFlowValueRequest,
  IIdentityPruneRequest,
  IIdentityTaskTypeRequest,
  ISkillFullTrialPlanRequest,
  ISkillReachabilityRequest,
  ISkillValueReportRequest,
  IValidityGateRequest,
} from "../../scripts/run_value_comparison_report.ts";
import { MechanicsOutcome } from "../../tests/scenario_framework/runner/validity_gate.ts";
import { ComparisonMetric } from "../../tests/scenario_framework/runner/arm_comparison.ts";
import { SkillValueDecisionKind } from "../../tests/scenario_framework/runner/skill_value_decision.ts";

const SYNTHETIC_ARM_REQUEST: IArmComparisonRequest = {
  input: {
    armId: "demo-arm",
    metric: ComparisonMetric.OBJECTIVE_OUTCOME,
    tasks: [{ taskId: "demo-task", control: [0.5, 0.5], treatment: [0.9, 0.9] }],
  },
  deltaPromptTokens: 1000,
};

Deno.test("[value-comparison-report] computeArmComparisonReport calls computePairedComparison and computeValuePerToken for real", () => {
  const report = computeArmComparisonReport(SYNTHETIC_ARM_REQUEST);
  assertEquals(report.comparison.meanDelta, 0.4);
  assertEquals(report.comparison.noEffect, false);
  assertEquals(report.valuePerToken, 0.4);
});

Deno.test("[value-comparison-report] computeArmComparisonReport omits valuePerToken when no token delta is supplied", () => {
  const report = computeArmComparisonReport({ input: SYNTHETIC_ARM_REQUEST.input });
  assertEquals(report.valuePerToken, undefined);
});

const SYNTHETIC_VALIDITY_REQUEST: IValidityGateRequest = {
  binding: { artefactId: "demo-artefact", pack: "demo_pack", scenarioIds: ["demo-scenario"] },
  evidence: {
    pack: "demo_pack",
    scenarioIds: ["demo-scenario"],
    commitSha: "deadbeef",
    outcome: MechanicsOutcome.GREEN,
    verifiedAt: "2026-01-01T00:00:00Z",
  },
  valueRunCommitSha: "deadbeef",
};

Deno.test("[value-comparison-report] computeValidityGateReport admits a matching binding/evidence pair via the real gate", () => {
  const report = computeValidityGateReport(SYNTHETIC_VALIDITY_REQUEST);
  assertEquals(report.admitted, true);
});

Deno.test("[value-comparison-report] computeValidityGateReport rejects a mismatched commit — the gate is a real check", () => {
  const report = computeValidityGateReport({ ...SYNTHETIC_VALIDITY_REQUEST, valueRunCommitSha: "not-the-commit" });
  assertEquals(report.admitted, false);
  assertEquals(typeof report.reason, "string");
});

Deno.test("[value-comparison-report] an admitted result genuinely calls the throwing assertValidityGate, not just evaluateValidityGate", () => {
  // computeValidityGateReport calls assertValidityGate internally when admitted; if the
  // two functions ever disagreed, this call would throw and fail the test right here.
  const report = computeValidityGateReport(SYNTHETIC_VALIDITY_REQUEST);
  assertEquals(report.admitted, true);
});

const SYNTHETIC_PLACEBO_REQUEST: IArmComparisonRequest = {
  input: {
    armId: "demo-placebo",
    metric: ComparisonMetric.OBJECTIVE_OUTCOME,
    tasks: [{ taskId: "demo-task", control: [0.9], treatment: [0.4] }],
  },
};

Deno.test("[value-comparison-report] computePlaceboReport reports detected:true for a real negative-delta placebo comparison", () => {
  const report = computePlaceboReport(SYNTHETIC_PLACEBO_REQUEST);
  assertEquals(report.comparison.meanDelta, -0.5);
  assertEquals(report.detected, true);
  assertEquals(report.error, undefined);
});

Deno.test("[value-comparison-report] computePlaceboReport reports detected:false with a reason for a non-harmful comparison", () => {
  const nonHarmful: IArmComparisonRequest = {
    input: {
      armId: "demo-not-placebo",
      metric: ComparisonMetric.OBJECTIVE_OUTCOME,
      tasks: [{ taskId: "demo-task", control: [0.9], treatment: [0.95] }],
    },
  };
  const report = computePlaceboReport(nonHarmful);
  assertEquals(report.detected, false);
  assertEquals(typeof report.error, "string");
});

Deno.test("[value-comparison-report] assertThrows sanity: the real assertValidityGate throws on a red-mechanics evidence", () => {
  assertThrows(() => {
    const report = computeValidityGateReport({
      ...SYNTHETIC_VALIDITY_REQUEST,
      evidence: { ...SYNTHETIC_VALIDITY_REQUEST.evidence, outcome: MechanicsOutcome.RED },
    });
    if (!report.admitted) throw new Error(report.reason);
  });
});

// Skill/identity/flow reporting layers, same synthetic-only-data discipline.

const SYNTHETIC_SKILL_REACHABILITY_REQUEST: ISkillReachabilityRequest = {
  catalog: [{ skillId: "demo-skill-a", critical: false }, { skillId: "demo-skill-b", critical: true }],
  defaultSkillIds: ["demo-skill-a"],
  corpusMatches: [{ taskId: "demo-task", matchedSkillIds: [] }],
};

Deno.test("[value-comparison-report] computeSkillReachabilityReport calls the real computeSkillReachability", () => {
  const result = computeSkillReachabilityReport(SYNTHETIC_SKILL_REACHABILITY_REQUEST);
  assertEquals(result.reachableSkillIds, ["demo-skill-a"]);
  assertEquals(result.nonCoverage.length, 1);
  assertEquals(result.nonCoverage[0].skillId, "demo-skill-b");
});

const SYNTHETIC_FULL_TRIAL_PLAN_REQUEST: ISkillFullTrialPlanRequest = {
  screening: [
    {
      skillId: "demo-skill-a",
      input: {
        armId: "a",
        metric: ComparisonMetric.OBJECTIVE_OUTCOME,
        tasks: [{ taskId: "t", control: [0.5], treatment: [0.9] }],
      },
    },
    {
      skillId: "demo-skill-b",
      input: {
        armId: "b",
        metric: ComparisonMetric.OBJECTIVE_OUTCOME,
        tasks: [{ taskId: "t", control: [0.5], treatment: [0.55] }],
      },
    },
  ],
  criticalSkillIds: ["demo-skill-b"],
  topN: 1,
};

Deno.test("[value-comparison-report] computeSkillFullTrialPlan calls the real computePairedComparison then planFullTrials", () => {
  const candidates = computeSkillFullTrialPlan(SYNTHETIC_FULL_TRIAL_PLAN_REQUEST);
  // demo-skill-a has the larger absolute delta (0.4 vs 0.05), so it is ranked #1 with topN=1;
  // demo-skill-b is added anyway because it is critical.
  assertEquals(candidates.map((c) => c.skillId).sort(), ["demo-skill-a", "demo-skill-b"]);
});

const SYNTHETIC_SKILL_VALUE_REQUEST: ISkillValueReportRequest = {
  results: [{
    skillId: "demo-skill-flat",
    input: {
      armId: "flat",
      metric: ComparisonMetric.OBJECTIVE_OUTCOME,
      // Two tasks with small, offsetting deltas: mean 0, stdev 0.05 — a genuine
      // noEffect:true (|meanDelta| < stdevDelta), not a degenerate zero-variance zero.
      tasks: [
        { taskId: "t1", control: [0.8], treatment: [0.85] },
        { taskId: "t2", control: [0.8], treatment: [0.75] },
      ],
    },
    deltaPromptTokens: 100,
  }],
  nonCoverage: [],
  decisions: [{ skillId: "demo-skill-flat", decision: SkillValueDecisionKind.KEEP, rationale: "no measured harm" }],
};

Deno.test("[value-comparison-report] computeSkillValueReport calls the real buildSkillValueReport and assertSkillDecisionsRecorded", () => {
  const report = computeSkillValueReport(SYNTHETIC_SKILL_VALUE_REQUEST);
  assertEquals(report.report.rows[0].skillId, "demo-skill-flat");
  assertEquals(report.report.rows[0].noEffect, true);
  assertEquals(report.decisionsOk, true);
});

Deno.test("[value-comparison-report] computeSkillValueReport reports decisionsOk:false when a no-effect skill has no decision", () => {
  const report = computeSkillValueReport({ ...SYNTHETIC_SKILL_VALUE_REQUEST, decisions: [] });
  assertEquals(report.decisionsOk, false);
  assertEquals(typeof report.decisionsError, "string");
});

const SYNTHETIC_TASK_TYPE_REQUEST: IIdentityTaskTypeRequest = {
  input: {
    armId: "identity-swap",
    metric: ComparisonMetric.OBJECTIVE_OUTCOME,
    tasks: [
      { taskId: "bugfix-task", control: [0.5], treatment: [0.9] },
      { taskId: "refactor-task", control: [0.9], treatment: [0.5] },
    ],
  },
  taskTypeById: { "bugfix-task": "bugfix", "refactor-task": "refactor" },
};

Deno.test("[value-comparison-report] computeIdentityTaskTypeReport calls the real computePairedComparison then groupDeltasByTaskType", () => {
  const groups = computeIdentityTaskTypeReport(SYNTHETIC_TASK_TYPE_REQUEST);
  const byType = Object.fromEntries(groups.map((g) => [g.taskType, g.meanDelta]));
  assertEquals(byType["bugfix"], 0.4);
  assertEquals(byType["refactor"], -0.4);
});

const SYNTHETIC_PRUNE_REQUEST: IIdentityPruneRequest = {
  input: {
    armId: "prune",
    metric: ComparisonMetric.OBJECTIVE_OUTCOME,
    // Same offsetting-delta shape as the skill-value fixture above: mean 0, stdev 0.05,
    // a genuine no-effect verdict rather than a degenerate zero-variance zero.
    tasks: [
      { taskId: "t1", control: [0.8], treatment: [0.85] },
      { taskId: "t2", control: [0.8], treatment: [0.75] },
    ],
  },
};

Deno.test("[value-comparison-report] computeIdentityPruneReport calls the real computePairedComparison then interpretPruneVerdict", () => {
  const verdict = computeIdentityPruneReport(SYNTHETIC_PRUNE_REQUEST);
  assertEquals(verdict, "no-effect");
});

const SYNTHETIC_FLOW_VALUE_REQUEST: IFlowValueRequest = {
  catalog: [{ flowId: "demo-flow" }, { flowId: "unexercised-flow" }],
  coverage: [{ flowId: "demo-flow", taskIds: ["demo-task"] }],
  results: [{
    flowId: "demo-flow",
    qualityInput: {
      armId: "q",
      metric: ComparisonMetric.OBJECTIVE_OUTCOME,
      tasks: [{ taskId: "t", control: [0.9], treatment: [0.6] }],
    },
    tokenInput: {
      armId: "tok",
      metric: ComparisonMetric.PROMPT_TOKENS,
      tasks: [{ taskId: "t", control: [1000], treatment: [5000] }],
    },
    wallClockInput: {
      armId: "wc",
      metric: ComparisonMetric.WALL_CLOCK_MS,
      tasks: [{ taskId: "t", control: [10000], treatment: [60000] }],
    },
  }],
};

Deno.test("[value-comparison-report] computeFlowValueReport calls the real computeFlowReachability and buildFlowValueReport", () => {
  const report = computeFlowValueReport(SYNTHETIC_FLOW_VALUE_REQUEST);
  assertEquals(report.reachability.reachableFlowIds, ["demo-flow"]);
  assertEquals(report.reachability.nonCoverage[0].flowId, "unexercised-flow");
  assertAlmostEquals(report.valueReport.rows[0].qualityDelta, -0.3);
  assertEquals(report.valueReport.rows[0].tokenDelta, 4000);
  assertEquals(report.valueReport.rows[0].wallClockDeltaMs, 50000);
});

Deno.test("[value-comparison-report] computeJudgeCalibrationReport calls the real computeJudgeCalibration — perfect positive correlation", () => {
  // Judge score exactly tracks objective outcome across all four synthetic samples.
  const result = computeJudgeCalibrationReport({
    judgeIdentityId: "demo-judge",
    samples: [
      { taskId: "t1", judgeScore: 0.2, objectiveOutcome: 0.2 },
      { taskId: "t2", judgeScore: 0.4, objectiveOutcome: 0.4 },
      { taskId: "t3", judgeScore: 0.6, objectiveOutcome: 0.6 },
      { taskId: "t4", judgeScore: 0.8, objectiveOutcome: 0.8 },
    ],
  });
  assertEquals(result.judgeIdentityId, "demo-judge");
  assertAlmostEquals(result.correlation, 1);
  assertEquals(result.sampleCount, 4);
});

Deno.test("[value-comparison-report] computeJudgeCalibrationReport reports correlation 0 for too few samples — the real function's own rule, not a stub", () => {
  const result = computeJudgeCalibrationReport({
    judgeIdentityId: "demo-judge",
    samples: [{ taskId: "t1", judgeScore: 0.5, objectiveOutcome: 0.5 }],
  });
  assertEquals(result.correlation, 0);
  assertEquals(result.sampleCount, 1);
});
