/**
 * @module ModelResolverCharacteristicsTest
 * @path packages/ai/tests/model_resolver_characteristics_test.ts
 * @description Phase 132 Step 1 — validates characteristic-based scoring in ModelResolver:
 *   trace contains scores, multiple characteristics blended, unknown characteristic ignored.
 */
import { assertEquals } from "@std/assert";
import { PricingTier, ProviderCostTier } from "@exaix/core";
import { initTestDbService } from "@exaix/testing";
import { createMockEventLogger } from "@exaix/testing/helpers/services/barrel.ts";
import { ProviderRegistry } from "../src/provider_registry.ts";
import { MockProviderFactory } from "../src/factories/mock_factory.ts";
import { DefaultRoutingStrategy } from "../src/routing/default_routing_strategy.ts";
import { createStubCostTracker, createStubHealthChecker } from "./helpers/service_stubs.ts";
import { ModelResolver } from "../src/model_resolver.ts";
import { createTestConfig } from "./helpers/test_config.ts";

function registerProvider(
  name: string,
  opts: {
    tier?: PricingTier;
    costTier?: ProviderCostTier;
    costPerMtok?: number;
  } = {},
): void {
  ProviderRegistry.registerWithMetadata(name, new MockProviderFactory(), {
    name,
    description: name,
    capabilities: ["chat"],
    costTier: opts.costTier ?? ProviderCostTier.FREE,
    pricingTier: opts.tier ?? PricingTier.LOCAL,
    strengths: ["general"],
    costPerMtok: opts.costPerMtok,
  });
}

function makeResolver(logger?: ReturnType<typeof createMockEventLogger>): ModelResolver {
  return new ModelResolver(
    new DefaultRoutingStrategy(ProviderRegistry, createStubCostTracker(), createStubHealthChecker()),
    createTestConfig(),
    createStubHealthChecker(),
    logger ?? createMockEventLogger(),
  );
}

Deno.test("[step132.1][characteristics] trace contains scores for characteristic-cheapest", async () => {
  const { cleanup } = await initTestDbService();
  try {
    ProviderRegistry.clear();
    registerProvider("cheap", { costPerMtok: 1 });
    registerProvider("expensive", { costPerMtok: 100 });

    const logger = createMockEventLogger();
    const resolver = makeResolver(logger);
    await resolver.resolve({ characteristics: ["cheapest"] });

    const traceEvents = logger.events.filter((e) => e.action === "model.resolved");
    assertEquals(traceEvents.length, 1);
    const scores = JSON.parse(traceEvents[0].payload?.scores as string ?? "{}");
    assertEquals(typeof scores.cheap, "number");
    assertEquals(typeof scores.expensive, "number");
    // cheap should have a higher score (lower cost = higher score)
    assertEquals(scores.cheap > scores.expensive, true);
  } finally {
    await cleanup();
  }
});

Deno.test("[step132.1][characteristics] multiple characteristics blended", async () => {
  const { cleanup } = await initTestDbService();
  try {
    ProviderRegistry.clear();
    registerProvider("cheap", { costPerMtok: 1 });
    registerProvider("medium", { costPerMtok: 50 });
    registerProvider("expensive", { costPerMtok: 100 });

    const resolver = makeResolver();
    const result = await resolver.resolve({ characteristics: ["cheapest", "fastest"] });

    assertEquals(typeof result.provider, "string");
    assertEquals(result.attempt, 1);
  } finally {
    await cleanup();
  }
});

Deno.test("[step132.1][characteristics] unknown characteristic is ignored", async () => {
  const { cleanup } = await initTestDbService();
  try {
    ProviderRegistry.clear();
    registerProvider("fallback");

    const resolver = makeResolver();
    const result = await resolver.resolve({ characteristics: ["nonexistent"] });

    assertEquals(result.provider, "fallback");
  } finally {
    await cleanup();
  }
});
