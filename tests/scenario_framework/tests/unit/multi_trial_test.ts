/**
 * @module ScenarioFrameworkMultiTrialTest
 * @path tests/scenario_framework/tests/unit/multi_trial_test.ts
 * @description Tests for multi-trial metrics computation.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/scoring.ts]
 */

import { assertEquals } from "@std/assert";
import { computeMultiTrialMetrics } from "../../runner/scoring.ts";

Deno.test("[MultiTrial] 5 trials all passing returns pass_at_1=1.0, pass^k=5", () => {
  const metrics = computeMultiTrialMetrics([1, 1, 1, 1, 1], 0.5);
  assertEquals(metrics.mean, 1.0);
  assertEquals(metrics.min, 1.0);
  assertEquals(metrics.max, 1.0);
  assertEquals(metrics.pass_at_1, 1.0);
  assertEquals(metrics.pass_k, 5);
});

Deno.test("[MultiTrial] 3/5 passing returns correct pass_at_1 and mean", () => {
  const metrics = computeMultiTrialMetrics([1, 0, 1, 0, 1], 0.5);
  assertEquals(metrics.pass_at_1, 0.6);
  assertEquals(metrics.mean, 0.6);
  assertEquals(metrics.pass_k, 1); // first trial passes, second fails
});

Deno.test("[MultiTrial] first 2 pass, 3rd fails returns pass^k=2", () => {
  const metrics = computeMultiTrialMetrics([1, 1, 0, 1, 1], 0.5);
  assertEquals(metrics.pass_k, 2);
  assertEquals(metrics.pass_at_1, 0.8);
});

Deno.test("[MultiTrial] all fail returns pass_at_1=0, pass_k=0", () => {
  const metrics = computeMultiTrialMetrics([0, 0, 0], 0.5);
  assertEquals(metrics.pass_at_1, 0.0);
  assertEquals(metrics.pass_k, 0);
  assertEquals(metrics.mean, 0.0);
});

Deno.test("[MultiTrial] empty array returns zero metrics", () => {
  const metrics = computeMultiTrialMetrics([], 0.5);
  assertEquals(metrics.mean, 0);
  assertEquals(metrics.pass_at_1, 0);
  assertEquals(metrics.pass_k, 0);
});

Deno.test("[MultiTrial] custom threshold changes pass/fail classification", () => {
  // Scores [0.6, 0.7, 0.8] with threshold 0.75 → only 0.8 passes
  const metrics = computeMultiTrialMetrics([0.6, 0.7, 0.8], 0.75);
  assertEquals(metrics.pass_at_1, 1 / 3);
  assertEquals(metrics.pass_k, 0); // first trial 0.6 < 0.75
});
