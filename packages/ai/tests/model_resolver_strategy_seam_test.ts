/**
 * @module ModelResolverStrategySeamTest
 * @path packages/ai/tests/model_resolver_strategy_seam_test.ts
 * @description Phase 135 Step 1 (GAP-1) — the IResolutionStrategy seam on ModelResolver:
 *   an unset strategy is byte-identical to 134 behaviour; a registered validateExplicit
 *   hook is invoked for an explicit provider:model choice.
 * @architectural-layer AI-Routing
 */
import { assertEquals } from "@std/assert";
import { initTestDbService } from "@exaix/testing";
import { createMockEventLogger } from "@exaix/testing/helpers/services/barrel.ts";
import { ModelResolver } from "../src/model_resolver.ts";
import type { IResolutionStrategy } from "../src/i_resolution_strategy.ts";
import { PricingTier, ProviderCostTier } from "@exaix/core";
import { ProviderRegistry } from "../src/provider_registry.ts";
import { DefaultRoutingStrategy } from "../src/routing/default_routing_strategy.ts";
import { MockProviderFactory } from "../src/factories/mock_factory.ts";
import { createTestConfig } from "./helpers/test_config.ts";
import { createStubCostTracker, createStubHealthChecker } from "./helpers/service_stubs.ts";

function registerProvider(name: string): void {
  ProviderRegistry.registerWithMetadata(name, new MockProviderFactory(), {
    name,
    description: name,
    capabilities: ["chat"],
    costTier: ProviderCostTier.FREE,
    pricingTier: PricingTier.LOCAL,
    strengths: ["general"],
  });
}

function makeResolver(strategy?: IResolutionStrategy): ModelResolver {
  return new ModelResolver(
    new DefaultRoutingStrategy(ProviderRegistry, createStubCostTracker(), createStubHealthChecker()),
    createTestConfig(),
    createStubHealthChecker(),
    createMockEventLogger(),
    undefined,
    strategy,
  );
}

Deno.test("[gap1] no strategy injected: explicit provider:model resolves 134-style (inert seam)", async () => {
  const { cleanup } = await initTestDbService();
  try {
    ProviderRegistry.clear();
    registerProvider("anthropic");
    const resolver = makeResolver(); // no strategy
    const resolved = await resolver.resolve({ model: "anthropic:claude-x" });
    assertEquals(resolved.provider, "anthropic");
    assertEquals(resolved.model, "claude-x");
  } finally {
    ProviderRegistry.clear();
    await cleanup();
  }
});

Deno.test("[gap1] validateExplicit hook is invoked when a strategy is registered", async () => {
  const { cleanup } = await initTestDbService();
  try {
    ProviderRegistry.clear();
    registerProvider("anthropic");
    let called: { provider: string; model: string } | null = null;
    const strategy: IResolutionStrategy = {
      validateExplicit: (provider, model) => {
        called = { provider, model };
        return Promise.resolve({ provider, model });
      },
    };
    const resolver = makeResolver(strategy);
    await resolver.resolve({ model: "anthropic:claude-x" });
    assertEquals(called, { provider: "anthropic", model: "claude-x" });
  } finally {
    ProviderRegistry.clear();
    await cleanup();
  }
});

Deno.test("[gap1][step3] Solo (no strategy) passes an unvalidated explicit provider:model through (G10 regression)", async () => {
  const { cleanup } = await initTestDbService();
  try {
    ProviderRegistry.clear();
    registerProvider("openrouter");
    // No strategy registered ⇒ the resolver must NOT validate/auto-admit; an arbitrary
    // (even unadmitted / non-real) explicit choice resolves verbatim, exactly as 134.
    const resolver = makeResolver();
    const resolved = await resolver.resolve({ model: "openrouter:vendor/never-admitted" });
    assertEquals(resolved.provider, "openrouter");
    assertEquals(resolved.model, "vendor/never-admitted");
  } finally {
    ProviderRegistry.clear();
    await cleanup();
  }
});
