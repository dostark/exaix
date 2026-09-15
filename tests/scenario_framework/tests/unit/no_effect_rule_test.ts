/**
 * @module ScenarioFrameworkNoEffectRuleTest
 * @path tests/scenario_framework/tests/unit/no_effect_rule_test.ts
 * @description Regression tests for the trial-aware no-effect rule: a paired confidence
 * interval containing zero or an effect below the declared minimum is reported as no effect.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/arm_comparison.ts]
 */

import { assertEquals } from "@std/assert";
import { computePairedComparison } from "../../runner/arm_comparison.ts";
import { ComparisonMetric } from "../../runner/arm_comparison.ts";

Deno.test("[NoEffectRule] an uncertain aggregate delta reports no effect", () => {
  const result = computePairedComparison({
    armId: "skill-noisy",
    metric: ComparisonMetric.JUDGE_SCORE,
    tasks: [
      { taskId: "task-1", control: [0.5], treatment: [0.55] }, // +0.05
      { taskId: "task-2", control: [0.5], treatment: [0.45] }, // -0.05
      { taskId: "task-3", control: [0.5], treatment: [0.52] }, // +0.02
    ],
  });

  // Paired deltas span zero, so the Student-t interval includes zero.
  assertEquals(result.noEffect, true);
});

Deno.test("[NoEffectRule] a large, consistent aggregate delta reports an effect", () => {
  const result = computePairedComparison({
    armId: "skill-strong",
    metric: ComparisonMetric.JUDGE_SCORE,
    tasks: [
      { taskId: "task-1", control: [0.4], treatment: [0.8] }, // +0.4
      { taskId: "task-2", control: [0.4], treatment: [0.85] }, // +0.45
      { taskId: "task-3", control: [0.4], treatment: [0.75] }, // +0.35
    ],
  });

  // The paired confidence interval excludes zero and exceeds the minimum effect.
  assertEquals(result.noEffect, false);
});

Deno.test("[NoEffectRule] symmetric per-task deltas that cancel to a zero mean report no effect", () => {
  // Two tasks whose deltas are +d and -d center the confidence interval on zero.
  const result = computePairedComparison({
    armId: "skill-boundary",
    metric: ComparisonMetric.JUDGE_SCORE,
    tasks: [
      { taskId: "task-1", control: [0.5], treatment: [0.6] }, // +0.1
      { taskId: "task-2", control: [0.5], treatment: [0.4] }, // -0.1
    ],
  });

  assertEquals(result.meanDelta, 0);
  assertEquals(result.noEffect, true);
});

Deno.test("[NoEffectRule] a single task with zero within-arm trial spread and a real delta reports an effect", () => {
  const result = computePairedComparison({
    armId: "skill-clean-signal",
    metric: ComparisonMetric.JUDGE_SCORE,
    tasks: [
      { taskId: "task-1", control: [0.5, 0.5, 0.5], treatment: [0.9, 0.9, 0.9] },
    ],
  });

  // Three identical paired trials have a zero-width interval away from zero.
  assertEquals(result.stdevDelta, 0);
  assertEquals(result.noEffect, false);
});
