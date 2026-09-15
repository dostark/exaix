/**
 * @module PairedTrialConfidenceTest
 * @path tests/scenario_framework/tests/unit/paired_trial_confidence_test.ts
 * @description Verifies trial-aware Student-t confidence and minimum-effect decisions.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/arm_comparison.ts]
 */

import { assertEquals, assertThrows } from "@std/assert";
import {
  ComparisonMetric,
  computePairedComparison,
  MIN_PERSONA_EFFECT,
  PERSONA_CONFIDENCE_LEVEL,
} from "../../runner/arm_comparison.ts";

Deno.test("[PairedTrialConfidence] reports deterministic interval provenance and an effect", () => {
  const result = computePairedComparison({
    armId: "persona",
    metric: ComparisonMetric.JUDGE_SCORE,
    tasks: [
      { taskId: "a", control: [0.2, 0.2, 0.2], treatment: [0.4, 0.4, 0.4] },
      { taskId: "b", control: [0.3, 0.3, 0.3], treatment: [0.5, 0.5, 0.5] },
    ],
  });
  assertEquals(result.confidenceLevel, PERSONA_CONFIDENCE_LEVEL);
  assertEquals(result.minimumEffect, MIN_PERSONA_EFFECT);
  assertEquals(result.pairedTrialCount, 6);
  assertEquals(Math.round(result.confidenceInterval.lower * 10) / 10, 0.2);
  assertEquals(Math.round(result.confidenceInterval.upper * 10) / 10, 0.2);
  assertEquals(result.decisionBasis, "measurable-effect");
  assertEquals(result.noEffect, false);
});

Deno.test("[PairedTrialConfidence] minimum effect and within-task uncertainty change the decision", () => {
  const belowMinimum = computePairedComparison({
    armId: "small",
    metric: ComparisonMetric.JUDGE_SCORE,
    tasks: [{ taskId: "a", control: [0, 0, 0], treatment: [0.005, 0.005, 0.005] }],
  });
  assertEquals(belowMinimum.decisionBasis, "below-minimum-effect");
  assertEquals(belowMinimum.noEffect, true);

  const uncertain = computePairedComparison({
    armId: "uncertain",
    metric: ComparisonMetric.JUDGE_SCORE,
    tasks: [{ taskId: "a", control: [0, 0, 0], treatment: [-0.2, 0.2, 0.2] }],
  });
  assertEquals(uncertain.decisionBasis, "confidence-interval-includes-zero");
  assertEquals(uncertain.noEffect, true);
});

Deno.test("[PairedTrialConfidence] rejects unequal index-paired arrays", () => {
  assertThrows(() =>
    computePairedComparison({
      armId: "invalid",
      metric: ComparisonMetric.JUDGE_SCORE,
      tasks: [{ taskId: "a", control: [0, 0], treatment: [0] }],
    })
  );
});
