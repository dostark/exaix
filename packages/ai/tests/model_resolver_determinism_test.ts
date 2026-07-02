/**
 * @module ModelResolverDeterminismTest
 * @path packages/ai/tests/model_resolver_determinism_test.ts
 * @description Tests EXA_MODEL_PRESET_OVERRIDE env var for deterministic model
 *   resolution across all model sizes. Phase 132 Step 8.
 * @architectural-layer Test
 * @dependencies [@std/assert, @exaix/testing]
 * @related-files [packages/ai/src/model_resolver.ts]
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
    supportsThinking: false,
    costPerMtok: 0,
  });
}

function makeResolver(): ModelResolver {
  return new ModelResolver(
    new DefaultRoutingStrategy(ProviderRegistry, createStubCostTracker(), createStubHealthChecker()),
    createTestConfig(),
    createStubHealthChecker(),
    createMockEventLogger(),
  );
}

Deno.test("[step132.8] EXA_MODEL_PRESET_OVERRIDE=test pins all sizes to mock:mock-model", async () => {
  const { cleanup } = await initTestDbService();
  try {
    ProviderRegistry.clear();
    registerProvider("mock");

    const resolver = makeResolver();

    Deno.env.set("EXA_MODEL_PRESET_OVERRIDE", "test");

    for (const size of ["S", "M", "L", "XL"] as const) {
      const result = await resolver.resolve({ model_size: size });
      assertEquals(result.provider, "mock", `size ${size}: expected provider mock`);
      assertEquals(result.model, "mock-model", `size ${size}: expected model mock-model`);
    }

    Deno.env.delete("EXA_MODEL_PRESET_OVERRIDE");
  } finally {
    await cleanup();
  }
});

Deno.test("[step132.8] EXA_MODEL_PRESET_OVERRIDE without model_size falls through to normal path", async () => {
  const { cleanup } = await initTestDbService();
  try {
    ProviderRegistry.clear();
    registerProvider("test-provider");

    const resolver = makeResolver();

    Deno.env.set("EXA_MODEL_PRESET_OVERRIDE", "test");
    const result = await resolver.resolve({ model: "test-provider:claude-sonnet" });
    assertEquals(result.provider, "test-provider");
    assertEquals(result.model, "claude-sonnet");

    Deno.env.delete("EXA_MODEL_PRESET_OVERRIDE");
  } finally {
    await cleanup();
  }
});

Deno.test("[step132.8] no EXA_MODEL_PRESET_OVERRIDE behaves normally", async () => {
  const { cleanup } = await initTestDbService();
  try {
    ProviderRegistry.clear();
    registerProvider("test-provider");

    const resolver = makeResolver();

    Deno.env.delete("EXA_MODEL_PRESET_OVERRIDE");
    const result = await resolver.resolve({ model: "test-provider:claude-sonnet" });
    assertEquals(result.provider, "test-provider");
    assertEquals(result.model, "claude-sonnet");
  } finally {
    await cleanup();
  }
});
