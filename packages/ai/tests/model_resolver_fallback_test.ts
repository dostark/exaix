/**
 * @module ModelResolverFallbackTest
 * @path packages/ai/tests/model_resolver_fallback_test.ts
 * @description Phase 132 Step 1 — validates fallback iteration in ModelResolver:
 *   fallback intent used when primary criteria reject all providers,
 *   primary intent succeeds when no fallback needed,
 *   throws when all attempts fail.
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
import { ConnectionError } from "../src/providers/common.ts";
import type { IProviderRoutingStrategy } from "../src/routing/provider_routing_strategy.ts";

function registerProvider(
  name: string,
  opts: {
    tier?: PricingTier;
    costTier?: ProviderCostTier;
  } = {},
): void {
  ProviderRegistry.registerWithMetadata(name, new MockProviderFactory(), {
    name,
    description: name,
    capabilities: ["chat"],
    costTier: opts.costTier ?? ProviderCostTier.FREE,
    pricingTier: opts.tier ?? PricingTier.LOCAL,
    strengths: ["general"],
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

Deno.test("[step132.1][fallback] fallback iterates when primary criteria reject all providers", async () => {
  const { cleanup } = await initTestDbService();
  try {
    ProviderRegistry.clear();
    registerProvider("fallback-1", { tier: PricingTier.LOW });

    const resolver = makeResolver();
    const result = await resolver.resolve({
      required_capabilities: ["vision"],
      fallbacks: [{ required_capabilities: ["chat"] }],
    });

    assertEquals(result.provider, "fallback-1");
    assertEquals(result.attempt, 2);
  } finally {
    await cleanup();
  }
});

Deno.test("[step132.1][fallback] primary intent succeeds when no fallback needed", async () => {
  const { cleanup } = await initTestDbService();
  try {
    ProviderRegistry.clear();
    registerProvider("primary");

    const resolver = makeResolver();
    const result = await resolver.resolve({
      required_capabilities: ["chat"],
      fallbacks: [{ required_capabilities: ["vision"] }],
    });

    assertEquals(result.provider, "primary");
    assertEquals(result.attempt, 1);
  } finally {
    await cleanup();
  }
});

Deno.test("[step132.1][fallback] throws when all attempts fail", async () => {
  const { cleanup } = await initTestDbService();
  try {
    ProviderRegistry.clear();
    registerProvider("some-provider");

    const resolver = makeResolver();
    await assertRejects(
      () =>
        resolver.resolve({
          required_capabilities: ["vision"],
        }),
      Error,
    );
  } finally {
    await cleanup();
  }
});

Deno.test("[step132.1][fallback] retryable error on primary re-resolves with first fallback (attempt:2)", async () => {
  const { cleanup } = await initTestDbService();
  try {
    ProviderRegistry.clear();
    registerProvider("fallback-1");

    let selectorCalls = 0;
    const retryThenResolve: IProviderRoutingStrategy = {
      selectProvider: () => {
        selectorCalls++;
        if (selectorCalls === 1) return Promise.reject(new ConnectionError("fallback-1", "connection reset"));
        return Promise.resolve("fallback-1");
      },
      selectProviderForTask: (_config, _taskType) => {
        selectorCalls++;
        return Promise.resolve("fallback-1");
      },
    };
    const logger = createMockEventLogger();
    const resolver = new ModelResolver(
      retryThenResolve,
      createTestConfig(),
      createStubHealthChecker(),
      logger,
    );

    const result = await resolver.resolve({
      required_capabilities: ["chat"],
      fallbacks: [{ required_capabilities: ["chat"] }],
    });

    assertEquals(selectorCalls, 2, "first attempt must throw and the second must re-resolve");
    assertEquals(result.provider, "fallback-1");
    assertEquals(result.attempt, 2);

    const resolvedEvents = logger.events.filter((e) => e.action === "model.resolved");
    assertEquals(resolvedEvents[0]?.payload?.reason, "fallback", "a fallback attempt must trace reason 'fallback'");
  } finally {
    await cleanup();
  }
});
