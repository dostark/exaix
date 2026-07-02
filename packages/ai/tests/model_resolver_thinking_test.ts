/**
 * @module ModelResolverThinkingTest
 * @path packages/ai/tests/model_resolver_thinking_test.ts
 * @description Phase 132 Step 1 — validates thinking constraint filtering in ModelResolver:
 *   selects thinking-capable provider when thinking:true, throws when none available,
 *   does not filter when only effort is specified.
 */
import { assertEquals, assertRejects } from "@std/assert";
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
    supportsThinking?: boolean;
  } = {},
): void {
  ProviderRegistry.registerWithMetadata(name, new MockProviderFactory(), {
    name,
    description: name,
    capabilities: ["chat"],
    costTier: opts.costTier ?? ProviderCostTier.FREE,
    pricingTier: opts.tier ?? PricingTier.LOCAL,
    strengths: ["general"],
    supportsThinking: opts.supportsThinking,
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

Deno.test("[step132.1][thinking] selects thinking-capable provider when thinking:true", async () => {
  const { cleanup } = await initTestDbService();
  try {
    ProviderRegistry.clear();
    registerProvider("basic", { supportsThinking: false });
    registerProvider("thinker", { supportsThinking: true });

    const resolver = makeResolver();
    const result = await resolver.resolve({ thinking: true });

    assertEquals(result.provider, "thinker");
    assertEquals(result.options?.thinking, true);
  } finally {
    await cleanup();
  }
});

Deno.test("[step132.1][thinking] throws when thinking:true but no provider supports it", async () => {
  const { cleanup } = await initTestDbService();
  try {
    ProviderRegistry.clear();
    registerProvider("basic", { supportsThinking: false });

    const resolver = makeResolver();
    await assertRejects(
      () => resolver.resolve({ thinking: true }),
      Error,
      "no suitable model found",
    );
  } finally {
    await cleanup();
  }
});

Deno.test("[step132.1][thinking] effort without thinking does not trigger thinking filter", async () => {
  const { cleanup } = await initTestDbService();
  try {
    ProviderRegistry.clear();
    registerProvider("basic", { supportsThinking: false });

    const resolver = makeResolver();
    const result = await resolver.resolve({ effort: "high" });

    assertEquals(result.provider, "basic");
    assertEquals(result.options?.effort, "high");
  } finally {
    await cleanup();
  }
});
