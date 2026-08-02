/**
 * @module ScenarioFrameworkNoEffectRuleTest
 * @path tests/scenario_framework/tests/unit/no_effect_rule_test.ts
 * @description Tests for the no-effect rule (Phase 158 Step 1): an aggregate delta
 * smaller in magnitude than its own cross-task standard deviation is noise, not a
 * real effect, and must be reported as "no effect" rather than a small effect. The
 * harness enforces this — it is not left to the reader to eyeball a small number.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/arm_comparison.ts]
 */

import { assertEquals } from "@std/assert";
import { computePairedComparison } from "../../runner/arm_comparison.ts";
import { ComparisonMetric } from "../../runner/arm_comparison.ts";

Deno.test("[NoEffectRule] a small aggregate delta below its own stdev reports no effect", () => {
  const result = computePairedComparison({
    armId: "skill-noisy",
    metric: ComparisonMetric.JUDGE_SCORE,
    tasks: [
      { taskId: "task-1", control: [0.5], treatment: [0.55] }, // +0.05
      { taskId: "task-2", control: [0.5], treatment: [0.45] }, // -0.05
      { taskId: "task-3", control: [0.5], treatment: [0.52] }, // +0.02
    ],
  });

  // deltas [0.05, -0.05, 0.02]: mean ~0.007, stdev ~0.04 — mean well below stdev
  assertEquals(result.noEffect, true);
});

Deno.test("[NoEffectRule] a large, consistent aggregate delta exceeding its stdev reports an effect", () => {
  const result = computePairedComparison({
    armId: "skill-strong",
    metric: ComparisonMetric.JUDGE_SCORE,
    tasks: [
      { taskId: "task-1", control: [0.4], treatment: [0.8] }, // +0.4
      { taskId: "task-2", control: [0.4], treatment: [0.85] }, // +0.45
      { taskId: "task-3", control: [0.4], treatment: [0.75] }, // +0.35
    ],
  });

  // deltas [0.4, 0.45, 0.35]: mean 0.4, stdev ~0.041 — mean well above stdev
  assertEquals(result.noEffect, false);
});

Deno.test("[NoEffectRule] symmetric per-task deltas that cancel to a zero mean report no effect", () => {
  // Two tasks whose deltas are +d and -d have mean 0 and stdev d>0 — mean(0) < stdev(d)
  // for any d>0, so a canceled-out mean can never register as an effect.
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

  // A single task has no cross-task stdev to compare against (stdevDelta = 0 for n=1),
  // so any nonzero delta registers as an effect.
  assertEquals(result.stdevDelta, 0);
  assertEquals(result.noEffect, false);
});
