/**
 * @module ScenarioFrameworkPlaceboArmTest
 * @path tests/scenario_framework/tests/unit/placebo_arm_test.ts
 * @description Tests for Phase 158 Step 3's placebo-detection check: a deliberately
 * harmful placebo artefact must produce a detectable negative delta, proving the
 * measurement pipeline can detect an effect at all on the day it runs — not just once
 * at design time. A placebo comparison that reads as no-effect means detection itself
 * is broken, independent of whether any real artefact under test has value.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/validity_gate.ts, tests/scenario_framework/runner/arm_comparison.ts]
 */

import { assertThrows } from "@std/assert";
import { computePairedComparison } from "../../runner/arm_comparison.ts";
import { ComparisonMetric } from "../../runner/arm_comparison.ts";
import { assertPlaceboDetected } from "../../runner/validity_gate.ts";

Deno.test("[PlaceboArm] a known-harmful placebo produces a detectable negative delta and passes", () => {
  const result = computePairedComparison({
    armId: "placebo-harmful-skill",
    metric: ComparisonMetric.JUDGE_SCORE,
    tasks: [
      { taskId: "task-1", control: [0.8, 0.8, 0.8], treatment: [0.3, 0.3, 0.3] },
      { taskId: "task-2", control: [0.7, 0.7, 0.7], treatment: [0.2, 0.2, 0.2] },
    ],
  });

  assertPlaceboDetected(result);
});

Deno.test("[PlaceboArm] a placebo whose deltas cancel out across tasks fails detection", () => {
  // meanDelta is exactly 0 but stdevDelta is not, so this exercises noEffect's own
  // boundary case distinctly from the "not actually harmful" (non-negative mean) case below.
  const result = computePairedComparison({
    armId: "placebo-harmful-skill",
    metric: ComparisonMetric.JUDGE_SCORE,
    tasks: [
      { taskId: "task-1", control: [0.5], treatment: [0.4] },
      { taskId: "task-2", control: [0.5], treatment: [0.6] },
    ],
  });

  assertThrows(() => assertPlaceboDetected(result), Error, "no detectable effect");
});

Deno.test("[PlaceboArm] a placebo whose delta is noise-sized (below stdev) fails detection", () => {
  const result = computePairedComparison({
    armId: "placebo-harmful-skill",
    metric: ComparisonMetric.JUDGE_SCORE,
    tasks: [
      { taskId: "task-1", control: [0.5], treatment: [0.48] },
      { taskId: "task-2", control: [0.5], treatment: [0.9] },
    ],
  });

  assertThrows(() => assertPlaceboDetected(result), Error, "no detectable effect");
});

Deno.test("[PlaceboArm] a placebo that is not actually harmful (non-negative delta) fails detection", () => {
  const result = computePairedComparison({
    armId: "placebo-harmful-skill",
    metric: ComparisonMetric.JUDGE_SCORE,
    tasks: [
      { taskId: "task-1", control: [0.5, 0.5, 0.5], treatment: [0.9, 0.9, 0.9] },
      { taskId: "task-2", control: [0.5, 0.5, 0.5], treatment: [0.8, 0.8, 0.8] },
    ],
  });

  assertThrows(() => assertPlaceboDetected(result), Error, "expected to be harmful");
});
