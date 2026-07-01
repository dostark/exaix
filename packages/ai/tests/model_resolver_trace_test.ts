/**
 * @module ModelResolverTraceTest
 * @path packages/ai/tests/model_resolver_trace_test.ts
 * @description Phase 132 Step 1 — validates model_resolved trace event emission from ModelResolver:
 *   explicit_override reason, preset_default reason, correct target and payload shape.
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

function makeResolver(logger?: ReturnType<typeof createMockEventLogger>): ModelResolver {
  return new ModelResolver(
    new DefaultRoutingStrategy(ProviderRegistry, createStubCostTracker(), createStubHealthChecker()),
    createTestConfig(),
    createStubHealthChecker(),
    logger ?? createMockEventLogger(),
  );
}

Deno.test("[step132.1][trace] model_resolved event emitted with explicit_override reason", async () => {
  const { cleanup } = await initTestDbService();
  try {
    ProviderRegistry.clear();
    registerProvider("trace-provider");

    const logger = createMockEventLogger();
    const resolver = makeResolver(logger);
    await resolver.resolve({ model: "trace-provider:my-model" });

    const events = logger.events.filter((e) => e.action === "model.resolved");
    assertEquals(events.length, 1);
    assertEquals(events[0].payload?.reason, "explicit_override");
  } finally {
    await cleanup();
  }
});

Deno.test("[step132.1][trace] model_resolved event emitted with preset_default reason", async () => {
  const { cleanup } = await initTestDbService();
  try {
    ProviderRegistry.clear();
    registerProvider("default-provider");

    const logger = createMockEventLogger();
    const resolver = makeResolver(logger);
    await resolver.resolve({});

    const events = logger.events.filter((e) => e.action === "model.resolved");
    assertEquals(events.length, 1);
    assertEquals(events[0].payload?.reason, "preset_default");
  } finally {
    await cleanup();
  }
});

Deno.test("[step132.1][trace] model_resolved event has correct target and payload shape", async () => {
  const { cleanup } = await initTestDbService();
  try {
    ProviderRegistry.clear();
    registerProvider("test-provider");

    const logger = createMockEventLogger();
    const resolver = makeResolver(logger);
    await resolver.resolve({ model: "test-provider:resolved-model" });

    const events = logger.events.filter((e) => e.action === "model.resolved");
    assertEquals(events.length, 1);
    assertEquals(events[0].target, "resolved-model");
    assertEquals(typeof events[0].payload?.selected, "string");
    assertEquals(typeof events[0].payload?.attempt, "string");
    assertEquals(typeof events[0].payload?.duration_ms, "string");
  } finally {
    await cleanup();
  }
});
