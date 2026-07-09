/**
 * @module CostExemptionTest
 * @path packages/model-registry/tests/cost_exemption_test.ts
 * @description Tests for the D7 cost-exemption predicate in model-registry.
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
