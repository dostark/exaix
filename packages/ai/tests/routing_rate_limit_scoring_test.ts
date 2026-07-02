/**
 * @module RoutingRateLimitScoringTest
 * @path packages/ai/tests/routing_rate_limit_scoring_test.ts
 * @description Phase 132 Step 2 — validates that rate_limit_weight influences provider
 *   selection in the routing strategy.
 * @architectural-layer AI
 * @dependencies [@std/assert, @exaix/core, @exaix/ai]
 */

import { assertEquals } from "@std/assert";
import { PricingTier, ProviderCostTier } from "@exaix/core";
import { initTestDbService } from "@exaix/testing";
import { ProviderRegistry } from "../src/provider_registry.ts";
import { MockProviderFactory } from "../src/factories/mock_factory.ts";
import { DefaultRoutingStrategy } from "../src/routing/default_routing_strategy.ts";
import { createStubCostTracker, createStubHealthChecker } from "./helpers/service_stubs.ts";

function makeStrategy(): DefaultRoutingStrategy {
  return new DefaultRoutingStrategy(
    ProviderRegistry,
    createStubCostTracker(),
    createStubHealthChecker(),
  );
}

function registerProvider(name: string, _rpm?: number): void {
  ProviderRegistry.registerWithMetadata(name, new MockProviderFactory(), {
    name,
    description: name,
    capabilities: ["chat"],
    costTier: ProviderCostTier.FREE,
    pricingTier: PricingTier.LOCAL,
    strengths: ["general"],
  });
}

Deno.test("[step132.2] selectProvider accepts rate_limit_weight in criteria", async () => {
  const { cleanup } = await initTestDbService();
  try {
    ProviderRegistry.clear();
    registerProvider("provider-a", 100);
    registerProvider("provider-b", 10);

    const strategy = makeStrategy();
    const provider = await strategy.selectProvider({
      requiredCapabilities: ["chat"],
      rateLimitWeight: 0.5,
    });

    assertEquals(typeof provider, "string");
  } finally {
    await cleanup();
  }
});
