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

/** Register a provider that satisfies the "M" preset (context window + thinking). */
function registerPresetProvider(name: string): void {
  ProviderRegistry.registerWithMetadata(name, new MockProviderFactory(), {
    name,
    description: name,
    capabilities: ["chat"],
    costTier: ProviderCostTier.FREE,
    pricingTier: PricingTier.LOCAL,
    strengths: ["general"],
    supportsThinking: true,
    contextWindow: 200_000,
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

Deno.test("[gap1][step6] selectRoute hook applies to a non-pinned choice and its route_reason lands on the resolved model", async () => {
  const { cleanup } = await initTestDbService();
  try {
    ProviderRegistry.clear();
    registerPresetProvider("anthropic");
    registerPresetProvider("openrouter");
    let called: { provider: string; model: string } | null = null;
    const strategy: IResolutionStrategy = {
      selectRoute: (resolved) => {
        called = { provider: resolved.provider, model: resolved.model };
        return Promise.resolve({
          provider: "openrouter",
          model: resolved.model,
          route_reason: "cheapest",
          considered_routes: [
            { provider: "anthropic", price: 3, health_score: 1 },
            { provider: "openrouter", price: 2, health_score: 1 },
          ],
        });
      },
    };
    const resolver = makeResolver(strategy);
    // A bare model name resolves via the scoring path (non-pinned) → selectRoute applies.
    const resolved = await resolver.resolve({ model_size: "M" });
    assertEquals(called !== null, true);
    assertEquals(resolved.route_reason, "cheapest");
  } finally {
    ProviderRegistry.clear();
    await cleanup();
  }
});

Deno.test("[gap1][step6] explicit provider:model is pinned — selectRoute is NOT applied", async () => {
  const { cleanup } = await initTestDbService();
  try {
    ProviderRegistry.clear();
    registerProvider("anthropic");
    let called = false;
    const strategy: IResolutionStrategy = {
      selectRoute: (resolved) => {
        called = true;
        return Promise.resolve({ provider: resolved.provider, model: resolved.model, route_reason: "cheapest" });
      },
    };
    const resolver = makeResolver(strategy);
    const resolved = await resolver.resolve({ model: "anthropic:claude-x" });
    assertEquals(called, false); // pinned explicit skips the route sub-step
    assertEquals(resolved.route_reason, undefined);
  } finally {
    ProviderRegistry.clear();
    await cleanup();
  }
});

Deno.test("[gap1][step6] no strategy (Solo): no route sub-step, route_reason absent", async () => {
  const { cleanup } = await initTestDbService();
  try {
    ProviderRegistry.clear();
    registerPresetProvider("anthropic");
    const resolver = makeResolver(); // no strategy
    const resolved = await resolver.resolve({ model_size: "M" });
    assertEquals(resolved.route_reason, undefined);
  } finally {
    ProviderRegistry.clear();
    await cleanup();
  }
});

Deno.test("[gap9][step6] model.resolved trace payload carries route_reason and considered_routes when a route was selected", async () => {
  const { cleanup } = await initTestDbService();
  try {
    ProviderRegistry.clear();
    registerPresetProvider("anthropic");
    registerPresetProvider("openrouter");
    const logger = createMockEventLogger();
    const strategy: IResolutionStrategy = {
      selectRoute: (resolved) =>
        Promise.resolve({
          provider: "openrouter",
          model: resolved.model,
          route_reason: "cheapest",
          considered_routes: [
            { provider: "anthropic", price: 3, health_score: 1 },
            { provider: "openrouter", price: 2, health_score: 0.9 },
          ],
        }),
    };
    const resolver = new ModelResolver(
      new DefaultRoutingStrategy(ProviderRegistry, createStubCostTracker(), createStubHealthChecker()),
      createTestConfig(),
      createStubHealthChecker(),
      logger,
      undefined,
      strategy,
    );
    await resolver.resolve({ model_size: "M" });
    const resolvedEvents = logger.events.filter((e) => e.action === "model.resolved");
    const withRoute = resolvedEvents.find((e) => e.payload?.route_reason === "cheapest");
    assertEquals(withRoute !== undefined, true);
    assertEquals(typeof withRoute?.payload?.considered_routes, "string");
  } finally {
    ProviderRegistry.clear();
    await cleanup();
  }
});
