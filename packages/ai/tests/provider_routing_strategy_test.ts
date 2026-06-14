/**
 * @module ProviderRoutingStrategyTest
 * @path packages/ai/tests/provider_routing_strategy_test.ts
 * @related-files [packages/ai/src/routing/default_routing_strategy.ts, packages/ai/src/provider_selector.ts]
 * @architectural-layer AI
 * @description Phase 115 Step 2 — verifies the injectable IProviderRoutingStrategy seam:
 * DefaultRoutingStrategy reproduces the current ProviderSelector behaviour (parity), and an
 * injected stub strategy overrides routing. Keeps Solo on the default; paid editions inject
 * an advanced routing strategy via the edition composer (no edition branch in core).
 */

import { assertEquals } from "@std/assert";
import { PricingTier, ProviderCostTier } from "@exaix/core";
import { DefaultRoutingStrategy, type IProviderRoutingStrategy, ProviderRegistry, ProviderSelector } from "@exaix/ai";
import { MockProviderFactory } from "../src/factories/mock_factory.ts";
import { createStubCostTracker, createStubHealthChecker } from "./helpers/service_stubs.ts";
import { createTestConfig } from "./helpers/test_config.ts";
import { initTestDbService } from "@exaix/testing";

function registerProviders(): void {
  ProviderRegistry.clear();
  ProviderRegistry.registerWithMetadata("free-provider", new MockProviderFactory(), {
    name: "free-provider",
    description: "Free provider",
    capabilities: ["chat"],
    costTier: ProviderCostTier.FREE,
    pricingTier: PricingTier.LOCAL,
    strengths: ["general"],
  });
  ProviderRegistry.registerWithMetadata("paid-provider", new MockProviderFactory(), {
    name: "paid-provider",
    description: "Paid provider",
    capabilities: ["chat"],
    costTier: ProviderCostTier.PAID,
    pricingTier: PricingTier.HIGH,
    strengths: ["complex"],
  });
}

Deno.test("[ai] DefaultRoutingStrategy reproduces current selection (parity suite)", async () => {
  const { cleanup } = await initTestDbService();
  try {
    registerProviders();
    const costTracker = createStubCostTracker();
    const health = createStubHealthChecker();

    // The extracted default strategy and the default-wired ProviderSelector must agree.
    const direct = new DefaultRoutingStrategy(ProviderRegistry, costTracker, health);
    const selector = new ProviderSelector(ProviderRegistry, costTracker, health);

    const viaStrategy = await direct.selectProvider({ preferFree: true, requiredCapabilities: ["chat"] });
    const viaSelector = await selector.selectProvider({ preferFree: true, requiredCapabilities: ["chat"] });

    assertEquals(viaStrategy, "free-provider");
    assertEquals(viaSelector, viaStrategy);
  } finally {
    await cleanup();
  }
});

Deno.test("[ai] an injected stub strategy overrides routing", async () => {
  const { cleanup } = await initTestDbService();
  try {
    registerProviders();
    const costTracker = createStubCostTracker();
    const health = createStubHealthChecker();

    // A stub that always routes to paid-provider, ignoring registry/criteria — proves override.
    const stub: IProviderRoutingStrategy = {
      selectProvider: () => Promise.resolve("paid-provider"),
      selectProviderForTask: () => Promise.resolve("paid-provider"),
    };
    const selector = new ProviderSelector(ProviderRegistry, costTracker, health, stub);

    const picked = await selector.selectProvider({ preferFree: true, requiredCapabilities: ["chat"] });
    assertEquals(picked, "paid-provider"); // default would pick free-provider; the stub overrides

    const config = createTestConfig();
    const forTask = await selector.selectProviderForTask(config, "simple");
    assertEquals(forTask, "paid-provider");
  } finally {
    await cleanup();
  }
});
