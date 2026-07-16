/**
 * @module ScenarioFrameworkMultiTrialTest
 * @path tests/scenario_framework/tests/unit/multi_trial_test.ts
 * @description Tests for multi-trial metrics computation with corrected
 * pass_pow_k semantics (Phase 140 Step 2). Replaces the old leading-consecutive
 * pass_k with pass_pow_k = (c/n)^n per the Exact Metric Semantics table.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/scoring.ts]
 */

import { assertEquals } from "@std/assert";
import { computeMultiTrialMetrics } from "../../runner/scoring.ts";

Deno.test("[MultiTrial] 5 trials all passing at threshold 0.5 → pass_at_1=1.0, pass_pow_k=1.0", () => {
  const metrics = computeMultiTrialMetrics([1, 1, 1, 1, 1], 0.5);
  assertEquals(metrics.mean, 1.0);
  assertEquals(metrics.min, 1.0);
  assertEquals(metrics.max, 1.0);
  assertEquals(metrics.pass_at_1, 1.0);
  assertEquals(metrics.pass_pow_k, 1.0);
});

Deno.test("[MultiTrial] 3/5 passing at threshold 0.5 → pass_at_1=0.6, pass_pow_k=(0.6)^5", () => {
  const metrics = computeMultiTrialMetrics([1, 0, 1, 0, 1], 0.5);
  assertEquals(metrics.pass_at_1, 0.6);
  assertEquals(metrics.mean, 0.6);
  assertEquals(metrics.pass_pow_k, Math.pow(0.6, 5));
});

Deno.test("[MultiTrial] all 3 fail at threshold 0.5 → pass_at_1=0, pass_pow_k=0", () => {
  const metrics = computeMultiTrialMetrics([0, 0, 0], 0.5);
  assertEquals(metrics.pass_at_1, 0.0);
  assertEquals(metrics.pass_pow_k, 0.0);
  assertEquals(metrics.mean, 0.0);
});

Deno.test("[MultiTrial] empty array returns zero metrics", () => {
  const metrics = computeMultiTrialMetrics([], 0.5);
  assertEquals(metrics.mean, 0);
  assertEquals(metrics.pass_at_1, 0);
  assertEquals(metrics.pass_pow_k, 0);
  assertEquals(metrics.stdev, 0);
});

Deno.test("[MultiTrial] [0.9, 0.4, 0.9] at threshold 0.7 → pass_at_1=2/3, pass_pow_k=(2/3)^3", () => {
  const metrics = computeMultiTrialMetrics([0.9, 0.4, 0.9], 0.7);
  assertEquals(metrics.pass_at_1, 2 / 3);
  assertEquals(metrics.pass_pow_k, Math.pow(2 / 3, 3));
  assertEquals(metrics.mean, (0.9 + 0.4 + 0.9) / 3);
  assertEquals(metrics.min, 0.4);
  assertEquals(metrics.max, 0.9);
});

Deno.test("[MultiTrial] custom threshold 0.75 with [0.6, 0.7, 0.8] → only 0.8 above", () => {
  const metrics = computeMultiTrialMetrics([0.6, 0.7, 0.8], 0.75);
  assertEquals(metrics.pass_at_1, 1 / 3);
  assertEquals(metrics.pass_pow_k, Math.pow(1 / 3, 3));
});

Deno.test("[MultiTrial] single trial at threshold → pass_at_1 and pass_pow_k are 0 or 1", () => {
  const above = computeMultiTrialMetrics([0.9], 0.5);
  assertEquals(above.pass_at_1, 1.0);
  assertEquals(above.pass_pow_k, 1.0);

  const below = computeMultiTrialMetrics([0.3], 0.5);
  assertEquals(below.pass_at_1, 0.0);
  assertEquals(below.pass_pow_k, 0.0);
});

Deno.test("[MultiTrial] stdev computed with sample variance", () => {
  const metrics = computeMultiTrialMetrics([0.9, 0.4, 0.9], 0.5);
  const mean = (0.9 + 0.4 + 0.9) / 3;
  const variance = ((0.9 - mean) ** 2 + (0.4 - mean) ** 2 + (0.9 - mean) ** 2) / 3;
  assertEquals(metrics.stdev, Math.sqrt(variance));
});
