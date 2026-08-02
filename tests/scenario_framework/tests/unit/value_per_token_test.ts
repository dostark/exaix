/**
 * @module ScenarioFrameworkValuePerTokenTest
 * @path tests/scenario_framework/tests/unit/value_per_token_test.ts
 * @description Tests for value-per-1k-tokens (Phase 158 Step 1): value-per-1k-tokens
 * = delta score / (delta prompt tokens / 1000). The headline metric is value per
 * token, not raw delta, so a score gain bought with a large token cost must rank
 * below a smaller gain bought for free.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/arm_comparison.ts]
 */

import { assertEquals } from "@std/assert";
import { computeValuePerToken } from "../../runner/arm_comparison.ts";

Deno.test("[ValuePerToken] a positive score delta over 1000 prompt tokens yields the raw score delta", () => {
  assertEquals(computeValuePerToken(0.1, 1000), 0.1);
});

Deno.test("[ValuePerToken] the same score delta over more tokens yields a smaller value", () => {
  const cheap = computeValuePerToken(0.1, 1000);
  const expensive = computeValuePerToken(0.1, 5000);
  assertEquals(expensive < cheap, true);
});

Deno.test("[ValuePerToken] a large score gain for a large token cost ranks below a small gain for no cost", () => {
  const largeGainLargeCost = computeValuePerToken(0.2, 3000); // +0.02 quality for +3000 tokens is the plan's own example scale
  const smallGainNoCost = computeValuePerToken(0.02, 0);

  assertEquals(largeGainLargeCost < smallGainNoCost, true);
});

Deno.test("[ValuePerToken] zero token delta with a positive score delta is a free win — ranks above every finite value", () => {
  const freeWin = computeValuePerToken(0.05, 0);
  const expensiveWin = computeValuePerToken(10, 100000);

  assertEquals(Number.isFinite(freeWin), false);
  assertEquals(freeWin > expensiveWin, true);
});

Deno.test("[ValuePerToken] zero token delta with zero score delta is exactly zero value, not NaN or Infinity", () => {
  assertEquals(computeValuePerToken(0, 0), 0);
});

Deno.test("[ValuePerToken] a negative score delta with a positive token cost is negative value", () => {
  const value = computeValuePerToken(-0.1, 2000);
  assertEquals(value, -0.05);
});
