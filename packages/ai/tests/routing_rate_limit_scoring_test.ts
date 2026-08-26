/**
 * @module RoutingRateLimitScoringTest
 * @path packages/ai/tests/routing_rate_limit_scoring_test.ts
 * @description Phase 132 Step 2 / GAP-3 — validates that rate_limit_weight influences
 *   provider selection: ModelResolver blends per-provider rate-limit headroom
 *   (remaining/maxRpm) into the characteristic score when the config weight is > 0.
 * @architectural-layer AI
 * @dependencies [@std/assert, @exaix/core, @exaix/ai]
 */

import { assertEquals } from "@std/assert";
import { PricingTier, ProviderCostTier } from "@exaix/core";
import type { IModelRegistry } from "@exaix/core/types";
import { HealthStatus } from "@exaix/core/types";
import { initTestDbService } from "@exaix/testing";
import { createMockEventLogger } from "@exaix/testing/helpers/services/barrel.ts";
import type { Config } from "@exaix/schemas";
import { ProviderRegistry } from "../src/provider_registry.ts";
import { MockProviderFactory } from "../src/factories/mock_factory.ts";
import { DefaultRoutingStrategy } from "../src/routing/default_routing_strategy.ts";
import { createStubCostTracker, createStubHealthChecker } from "./helpers/service_stubs.ts";
import { ModelResolver } from "../src/model_resolver.ts";

function registerProvider(name: string, _rpm?: number): void {
  ProviderRegistry.registerWithMetadata(name, new MockProviderFactory(), {
    name,
    description: name,
    capabilities: ["chat"],
    costTier: ProviderCostTier.FREE,
    pricingTier: PricingTier.LOCAL,
    strengths: ["general"],
    // equal price so the characteristic score ties and the rate-limit blend decides
    costPerMtok: 1,
  });
}

Deno.test("[step132.2] selectProvider accepts rate_limit_weight in criteria", async () => {
  const { cleanup } = await initTestDbService();
  try {
    ProviderRegistry.clear();
    registerProvider("provider-a", 100);
    registerProvider("provider-b", 10);

    const strategy = new DefaultRoutingStrategy(
      ProviderRegistry,
      createStubCostTracker(),
      createStubHealthChecker(),
    );
    const provider = await strategy.selectProvider({
      requiredCapabilities: ["chat"],
      rateLimitWeight: 0.5,
    });

    assertEquals(typeof provider, "string");
  } finally {
    await cleanup();
  }
});

Deno.test("[132.20][GAP-3] rate_limit_weight:0.5 makes rate-limit headroom decide the winner", async () => {
  const { cleanup } = await initTestDbService();
  try {
    ProviderRegistry.clear();
    registerProvider("low-rl");
    registerProvider("high-rl");

    const registry: IModelRegistry = {
      getModelsByCapability: () => Promise.resolve([]),
      getContextWindow: () => Promise.resolve(100000),
      getModelCost: () => Promise.resolve(0),
      getModelPricing: () => Promise.resolve({ provider: "", model: "", provenance: "unknown" }),
      getModelCapability: () => Promise.resolve({}),
      getProviderModels: () => Promise.resolve([]),
      getAllProviders: () => Promise.resolve(["low-rl", "high-rl"]),
      recordLatency: () => Promise.resolve(),
      getLatencyStats: () => Promise.reject(new Error("not implemented")),
      rankByLatency: () => Promise.reject(new Error("not implemented")),
      recordCall: () => Promise.resolve(),
      getRateLimit: (provider: string) =>
        Promise.resolve(
          provider === "high-rl"
            ? { remaining: 90, maxRpm: 100, resetAt: 0 }
            : { remaining: 10, maxRpm: 100, resetAt: 0 },
        ),
      getProviderHealth: () => Promise.resolve(HealthStatus.HEALTHY),
    };

    const makeResolver = (weight: number) =>
      new ModelResolver(
        new DefaultRoutingStrategy(ProviderRegistry, createStubCostTracker(), createStubHealthChecker()),
        { provider_strategy: { rate_limit_weight: weight } } as Config,
        createStubHealthChecker(),
        createMockEventLogger(),
        registry,
      );

    // Without the weight, equal-cost candidates resolve to the strategy's default pick.
    const unweighted = await makeResolver(0).resolve({ characteristics: ["cheapest"] });
    // With weight 0.5, the high remaining/ maxRpm provider must win the blend.
    const weighted = await makeResolver(0.5).resolve({ characteristics: ["cheapest"] });

    assertEquals(weighted.provider, "high-rl");
    assertEquals(weighted.provider !== unweighted.provider, true, "rate-limit weight must change the winner");
  } finally {
    await cleanup();
  }
});
