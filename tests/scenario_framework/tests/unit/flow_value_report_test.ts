/**
 * @module ScenarioFrameworkFlowValueReportTest
 * @path tests/scenario_framework/tests/unit/flow_value_report_test.ts
 * @description Tests for Phase 158 Step 6's flow value report: separates quality delta
 * from cost delta (tokens, wall clock) rather than blending them into one score — a flow
 * that improves quality at several times the cost is a different verdict from one that
 * is free, and a single blended number cannot distinguish the two. This is the plan's
 * explicitly named Planned Test.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/flow_value_report.ts, tests/scenario_framework/runner/arm_comparison.ts]
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { buildFlowValueReport, renderFlowValueReportText } from "../../runner/flow_value_report.ts";
import { computePairedComparison } from "../../runner/arm_comparison.ts";
import { ComparisonMetric } from "../../runner/arm_comparison.ts";

function comparison(armId: string, metric: ComparisonMetric, control: number, treatment: number) {
  return computePairedComparison({
    armId,
    metric,
    tasks: [{ taskId: "task-1", control: [control], treatment: [treatment] }],
  });
}

Deno.test("[FlowValueReport] a flow that improves quality at higher cost reports both deltas separately, not blended", () => {
  const report = buildFlowValueReport(
    [{
      flowId: "refactoring",
      qualityComparison: comparison("refactoring-ablation", ComparisonMetric.OBJECTIVE_OUTCOME, 0.5, 0.8),
      tokenComparison: comparison("refactoring-ablation", ComparisonMetric.PROMPT_TOKENS, 1000, 4000),
      wallClockComparison: comparison("refactoring-ablation", ComparisonMetric.WALL_CLOCK_MS, 2000, 9000),
    }],
    [],
  );
  const row = report.rows[0];
  assertEquals(Math.round(row.qualityDelta * 100) / 100, 0.3);
  assertEquals(row.tokenDelta, 3000);
  assertEquals(row.wallClockDeltaMs, 7000);
});

Deno.test("[FlowValueReport] the quality no-effect verdict is independent of a nonzero cost delta", () => {
  const report = buildFlowValueReport(
    [{
      flowId: "flat-flow",
      qualityComparison: computePairedComparison({
        armId: "flat-flow-ablation",
        metric: ComparisonMetric.OBJECTIVE_OUTCOME,
        tasks: [
          { taskId: "task-1", control: [0.5], treatment: [0.4] },
          { taskId: "task-2", control: [0.5], treatment: [0.6] },
        ],
      }),
      tokenComparison: comparison("flat-flow-ablation", ComparisonMetric.PROMPT_TOKENS, 1000, 5000),
      wallClockComparison: comparison("flat-flow-ablation", ComparisonMetric.WALL_CLOCK_MS, 1000, 3000),
    }],
    [],
  );
  assertEquals(report.rows[0].qualityNoEffect, true);
  assertEquals(report.rows[0].tokenDelta, 4000);
});

Deno.test("[FlowValueReport] the non-coverage list is carried through to the report", () => {
  const report = buildFlowValueReport([], [{ flowId: "security_audit", reason: "no coverage entry" }]);
  assertEquals(report.rows.length, 0);
  assertEquals(report.nonCoverage[0].flowId, "security_audit");
});

Deno.test("[FlowValueReport] the rendered text shows quality, token and wall-clock deltas as separate columns", () => {
  const report = buildFlowValueReport(
    [{
      flowId: "refactoring",
      qualityComparison: comparison("refactoring-ablation", ComparisonMetric.OBJECTIVE_OUTCOME, 0.5, 0.8),
      tokenComparison: comparison("refactoring-ablation", ComparisonMetric.PROMPT_TOKENS, 1000, 4000),
      wallClockComparison: comparison("refactoring-ablation", ComparisonMetric.WALL_CLOCK_MS, 2000, 9000),
    }],
    [{ flowId: "security_audit", reason: "no coverage entry" }],
  );
  const text = renderFlowValueReportText(report);
  assertStringIncludes(text, "refactoring");
  assertStringIncludes(text, "0.30");
  assertStringIncludes(text, "3000");
  assertStringIncludes(text, "7000");
  assertStringIncludes(text, "security_audit");
});
