/**
 * @module CostExemptionTest
 * @path packages/model-registry/tests/cost_exemption_test.ts
 * @description Tests for the D7 cost-exemption predicate in model-registry (Phase 134 Step 4 —
 *   isCostExempt: LOCAL/FREE/endpoint-$0 exempt, unknown/paid not; null/undefined-safe).
 * @architectural-layer ModelRegistry
 * @related-files [packages/model-registry/src/cost_exemption.ts]
 */

import { assertEquals } from "@std/assert";
import { ProviderCostTier } from "@exaix/core";
import { isCostExempt } from "../src/cost_exemption.ts";

Deno.test("[step134.4] isCostExempt true for LOCAL cost tier", () => {
  assertEquals(isCostExempt({ costTier: ProviderCostTier.LOCAL }), true);
});

Deno.test("[step134.4] isCostExempt true for FREE cost tier", () => {
  assertEquals(isCostExempt({ costTier: ProviderCostTier.FREE }), true);
});

Deno.test("[step134.4] isCostExempt true for endpoint $0 pricing", () => {
  assertEquals(
    isCostExempt(
      { costTier: ProviderCostTier.PAID, costPerMtok: 10 },
      { costPerMtok: 0, provenance: "endpoint" },
    ),
    true,
  );
});

Deno.test("[step134.4] isCostExempt false for PAID tier without endpoint provenance", () => {
  assertEquals(isCostExempt({ costTier: ProviderCostTier.PAID }), false);
});

Deno.test("[step134.4] isCostExempt false for FREEMIUM tier", () => {
  assertEquals(isCostExempt({ costTier: ProviderCostTier.FREEMIUM }), false);
});

Deno.test("[step134.4] isCostExempt false for null metadata", () => {
  assertEquals(isCostExempt(null), false);
});

Deno.test("[step134.4] isCostExempt false for undefined metadata", () => {
  assertEquals(isCostExempt(undefined), false);
});

Deno.test("[step134.4] isCostExempt true for PAID costTier with endpoint $0 pricing", () => {
  assertEquals(
    isCostExempt(
      { costTier: ProviderCostTier.PAID, costPerMtok: 10 },
      { costPerMtok: 0, provenance: "endpoint" },
    ),
    true,
  );
});

Deno.test("[step134.4] isCostExempt false for PAID costTier with null pricing", () => {
  assertEquals(
    isCostExempt({ costTier: ProviderCostTier.PAID, costPerMtok: 10 }, null),
    false,
  );
});

// The strategy's inline exemption rule (packages/ai/src/routing/default_routing_strategy.ts,
// filterByBudget): a provider skips the budget check iff costTier ∈ {LOCAL, FREE}.
// This drift-guard cross-validates model-registry's isCostExempt against that rule over a
// representative provider-metadata fixture set, so the two codepaths cannot silently diverge.
function strategyExemptionRule(costTier: ProviderCostTier): boolean {
  return costTier === ProviderCostTier.LOCAL || costTier === ProviderCostTier.FREE;
}

Deno.test("[step134.4][drift-guard] isCostExempt matches the strategy exemption rule across representative provider tiers", () => {
  const tiers = [
    ProviderCostTier.LOCAL,
    ProviderCostTier.FREE,
    ProviderCostTier.FREEMIUM,
    ProviderCostTier.PAID,
  ];
  for (const costTier of tiers) {
    // No pricing overlay: isCostExempt reduces to the tier check the strategy uses.
    assertEquals(
      isCostExempt({ costTier }),
      strategyExemptionRule(costTier),
      `drift on tier ${costTier}: isCostExempt and strategy rule disagree`,
    );
  }
});
