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

Deno.test("model.resolved keeps its payload fields when a catalog price changes the winner", async () => {
  ProviderRegistry.clear();
  try {
    registerProvider("openrouter");
    registerProvider("competitor");
    const metadata = ProviderRegistry.getProviderMetadata("openrouter");
    const competitor = ProviderRegistry.getProviderMetadata("competitor");
    if (!metadata || !competitor) throw new Error("fixture metadata missing");
    metadata.costPerMtok = 3;
    metadata.modelInfo = () => Promise.resolve({ inputPerMtok: 0.02 });
    competitor.costPerMtok = 1;
    const logger = createMockEventLogger();
    const resolver = new ModelResolver(
      new DefaultRoutingStrategy(ProviderRegistry, createStubCostTracker(), createStubHealthChecker()),
      createTestConfig(),
      createStubHealthChecker(),
      logger,
    );
    const selected = await resolver.resolve({ characteristics: ["cheapest"], trace_id: "catalog-routing-trace" });
    assertEquals(selected.provider, "openrouter");
    const event = logger.events.find((entry) => entry.action === "model.resolved");
    assertEquals(Object.keys(event?.payload ?? {}).sort(), [
      "candidate_providers",
      "duration_ms",
      "intent",
      "reason",
      "scores",
      "selected",
      "trace_id",
    ]);
    assertEquals(event?.payload?.candidate_providers, ["openrouter", "competitor"]);
    assertEquals(event?.payload?.selected, { provider: "openrouter", model: "openrouter-model", attempt: 1 });
    assertEquals(event?.payload?.reason, "characteristics_scored");
    assertEquals(event?.payload?.trace_id, "catalog-routing-trace");
  } finally {
    ProviderRegistry.clear();
  }
});

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
