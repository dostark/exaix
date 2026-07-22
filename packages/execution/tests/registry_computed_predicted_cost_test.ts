/**
 * @module RegistryComputedPredictedCostTest
 * @path packages/execution/tests/registry_computed_predicted_cost_test.ts
 * @description Phase 140a Step 7 — RED-first tests. computeRegistryPredictedCost replaces
 * calculateCost()'s single flat blended per-provider rate (COST_RATE_ANTHROPIC = $0.005/1K,
 * sourced from Haiku's OUTPUT-only price, applied uniformly to every Anthropic model and to
 * combined input+output tokens with no split) with a real per-model, split input/output price
 * from the existing static_overlay.ts price table, plus Anthropic's documented 0.1x cache-read
 * discount multiplier. Distinct in kind from the heuristic estimator GAP-23/24/25 removed from
 * AgentOrchestrator: that estimator guessed at unmeasurable PRE-CALL output-token counts; this
 * function only re-prices already-measured, real, POST-CALL token counts — cost_source remains
 * "predicted", unchanged, never surfaced as tracked cost.
 * @architectural-layer Services
 * @related-files [packages/execution/src/strategies/react_loop_strategy.ts, packages/execution/src/strategies/legacy_strategy.ts, packages/model-registry/src/static_overlay.ts]
 */

import { assertAlmostEquals, assertEquals } from "@std/assert";
import { computeRegistryPredictedCost } from "../src/registry_computed_cost.ts";

Deno.test("[RegistryComputedPredictedCost] a known model's cost matches promptTokens*inputRate + completionTokens*outputRate, not the old flat rate", () => {
  // anthropic:claude-sonnet-5 in static_overlay.ts: inputPerMtok 3.00, outputPerMtok 15.00.
  const cost = computeRegistryPredictedCost("anthropic", "claude-sonnet-5", {
    promptTokens: 1_000_000,
    completionTokens: 1_000_000,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
  });

  // 1M prompt tokens @ $3/MTok + 1M completion tokens @ $15/MTok = $18.
  assertEquals(cost, 3.0 + 15.0);
  // The old flat rate (COST_RATE_ANTHROPIC = $0.005/1K on combined 2M tokens) would be $10 —
  // confirm the new figure is NOT that.
  const oldFlatRateResult = 0.005 * (2_000_000 / 1000);
  assertEquals(cost === oldFlatRateResult, false);
});

Deno.test("[RegistryComputedPredictedCost] cache-read tokens are discounted at Anthropic's documented 0.1x multiplier, not charged at full input price", () => {
  const withCacheRead = computeRegistryPredictedCost("anthropic", "claude-sonnet-5", {
    promptTokens: 0,
    completionTokens: 0,
    cacheReadTokens: 1_000_000,
    cacheCreationTokens: 0,
  });

  // 1M cache-read tokens @ $3/MTok * 0.1 = $0.30, not $3.00.
  assertAlmostEquals(withCacheRead!, 0.3);
});

Deno.test("[RegistryComputedPredictedCost] an unknown model (no static_overlay entry) returns undefined, never a fabricated figure", () => {
  const cost = computeRegistryPredictedCost("anthropic", "some-unlisted-future-model", {
    promptTokens: 100,
    completionTokens: 50,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
  });

  assertEquals(cost, undefined);
});

Deno.test("[RegistryComputedPredictedCost] zero tokens across the board produces a real zero, not undefined", () => {
  const cost = computeRegistryPredictedCost("anthropic", "claude-sonnet-5", {
    promptTokens: 0,
    completionTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
  });

  assertEquals(cost, 0);
});
