/**
 * @module ModelResolverTest
 * @path packages/ai/tests/model_resolver_test.ts
 * @description Phase 132 Step 1 — validates ModelResolver: explicit overrides, selector-based resolution,
 *   error handling when no provider matches, and trace event emission.
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
    supportsThinking: opts.supportsThinking,
    costPerMtok: opts.costPerMtok,
  });
}

function makeResolver(eventLogger?: ReturnType<typeof createMockEventLogger>): ModelResolver {
  return new ModelResolver(
    new DefaultRoutingStrategy(ProviderRegistry, createStubCostTracker(), createStubHealthChecker()),
    createTestConfig(),
    createStubHealthChecker(),
    eventLogger ?? createMockEventLogger(),
  );
}

Deno.test("[step132.1] explicit provider:model override bypasses resolver", async () => {
  const { cleanup } = await initTestDbService();
  try {
    ProviderRegistry.clear();
    registerProvider("test-provider");

    const resolver = makeResolver();
    const result = await resolver.resolve({ model: "test-provider:claude-sonnet" });

    assertEquals(result.provider, "test-provider");
    assertEquals(result.model, "claude-sonnet");
    assertEquals(result.attempt, 1);
  } finally {
    await cleanup();
  }
});

Deno.test("[step132.1] explicit override returns options when effort specified", async () => {
  const { cleanup } = await initTestDbService();
  try {
    ProviderRegistry.clear();
    registerProvider("test-provider");

    const resolver = makeResolver();
    const result = await resolver.resolve({ model: "test-provider:claude-sonnet", effort: "high" });

    assertEquals(result.provider, "test-provider");
    assertEquals(result.model, "claude-sonnet");
    assertEquals(result.options?.effort, "high");
    assertEquals(result.options?.max_tokens, 8192);
  } finally {
    await cleanup();
  }
});

Deno.test("[step132.1] resolves to a registered provider via selector criteria", async () => {
  const { cleanup } = await initTestDbService();
  try {
    ProviderRegistry.clear();
    registerProvider("free-provider");
    registerProvider("paid-provider", { tier: PricingTier.HIGH, costTier: ProviderCostTier.PAID });

    const resolver = makeResolver();
    const result = await resolver.resolve({ max_cost_usd: 0 });

    assertEquals(result.provider, "free-provider");
    assertEquals(typeof result.model, "string");
    assertEquals(result.model.length > 0, true);
  } finally {
    await cleanup();
  }
});

Deno.test("[step132.1] throws when no provider matches criteria", async () => {
  const { cleanup } = await initTestDbService();
  try {
    ProviderRegistry.clear();
    // Register a provider without required capability
    ProviderRegistry.registerWithMetadata("no-streaming", new MockProviderFactory(), {
      name: "no-streaming",
      description: "No streaming",
      capabilities: [],
      costTier: ProviderCostTier.FREE,
      pricingTier: PricingTier.LOCAL,
      strengths: [],
    });

    const resolver = makeResolver();
    await assertRejects(
      () => resolver.resolve({ required_capabilities: ["streaming"] }),
      Error,
      "no suitable model found",
    );
  } finally {
    await cleanup();
  }
});

Deno.test("[step132.1] traces emit model_resolved event", async () => {
  const { cleanup } = await initTestDbService();
  try {
    ProviderRegistry.clear();
    registerProvider("trace-provider", { costPerMtok: 1 });

    const logger = createMockEventLogger();
    const resolver = makeResolver(logger);
    await resolver.resolve({ model: "trace-provider:some-model" });

    const events = logger.events.filter((e) => e.action === "model.resolved");
    assertEquals(events.length, 1);
    assertEquals(events[0].target, "some-model");
  } finally {
    await cleanup();
  }
});
