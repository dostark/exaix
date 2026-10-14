/**
 * @module ModelResolverContextWindowTest
 * @path packages/ai/tests/model_resolver_context_window_test.ts
 * @description Phase 132 Step 1 — validates context-window default resolution in ModelResolver:
 *   resolves with default model size when no size specified.
 */
import { assertEquals, assertRejects } from "@std/assert";
import { PricingTier, ProviderCostTier } from "@exaix/core";
import { HealthStatus } from "@exaix/core/types";
import type { IModelEntry, IModelRegistry, Opt, Reason } from "@exaix/core/types";
import { initTestDbService } from "@exaix/testing";
import { createMockEventLogger } from "@exaix/testing/helpers/services/barrel.ts";
import { ProviderRegistry } from "../src/provider_registry.ts";
import { MockProviderFactory } from "../src/factories/mock_factory.ts";
import { DefaultRoutingStrategy } from "../src/routing/default_routing_strategy.ts";
import { createStubCostTracker, createStubHealthChecker } from "./helpers/service_stubs.ts";
import { ModelResolver, resolvePresetFromSize } from "../src/model_resolver.ts";
import { createTestConfig } from "./helpers/test_config.ts";
import { OPENROUTER_PROVIDER_METADATA } from "@exaix/ai-openrouter";

function registerProvider(name: string): void {
  ProviderRegistry.registerWithMetadata(name, new MockProviderFactory(), {
    name,
    description: name,
    capabilities: ["chat"],
    costTier: ProviderCostTier.FREE,
    pricingTier: PricingTier.LOCAL,
    strengths: ["general"],
    contextWindow: 8192,
  });
}

function makeResolver(
  logger?: Opt<ReturnType<typeof createMockEventLogger>, Reason.OptionalContext>,
  registry?: Opt<IModelRegistry, Reason.OptionalDependency>,
): ModelResolver {
  return new ModelResolver(
    new DefaultRoutingStrategy(ProviderRegistry, createStubCostTracker(), createStubHealthChecker()),
    createTestConfig(),
    createStubHealthChecker(),
    logger ?? createMockEventLogger(),
    registry,
  );
}

Deno.test("a size preset filters OpenRouter by its per-model context window, cost and thinking", async () => {
  ProviderRegistry.clear();
  try {
    registerProvider("openrouter");
    const metadata = ProviderRegistry.getProviderMetadata("openrouter");
    if (!metadata) throw new Error("fixture metadata missing");
    const profile = { M: { min_context_window: 200_000, max_cost_per_mtok: 1, supports_thinking: true } };
    metadata.costPerMtok = 3;
    metadata.supportsThinking = false;
    metadata.modelInfo = () => Promise.resolve({ contextWindow: 262_144, inputPerMtok: 0.02, supportsThinking: true });
    assertEquals((await resolvePresetFromSize("M", profile)).provider, "openrouter");
    metadata.modelInfo = () => Promise.resolve({ contextWindow: 8192, inputPerMtok: 0.02, supportsThinking: true });
    await assertRejects(() => Promise.resolve(resolvePresetFromSize("M", profile)), Error, "min_context_window");
    metadata.modelInfo = () => Promise.resolve({ contextWindow: 262_144, inputPerMtok: 2, supportsThinking: true });
    await assertRejects(() => Promise.resolve(resolvePresetFromSize("M", profile)), Error, "max_cost_per_mtok");
    metadata.modelInfo = () => Promise.resolve({ contextWindow: 262_144, inputPerMtok: 0, supportsThinking: false });
    await assertRejects(() => Promise.resolve(resolvePresetFromSize("M", profile)), Error, "thinking");
  } finally {
    ProviderRegistry.clear();
  }
});

Deno.test("an unknown window passes the preset filter after the lookup rejects", async () => {
  ProviderRegistry.clear();
  try {
    registerProvider("openrouter");
    const metadata = ProviderRegistry.getProviderMetadata("openrouter");
    if (!metadata) throw new Error("fixture metadata missing");
    metadata.contextWindow = undefined;
    metadata.modelInfo = () => Promise.reject(new Error("catalog unavailable"));
    assertEquals(
      (await resolvePresetFromSize("M", {
        M: { min_context_window: 200_000, max_cost_per_mtok: 1, supports_thinking: false },
      })).provider,
      "openrouter",
    );
  } finally {
    ProviderRegistry.clear();
  }
});

Deno.test("[step132.1][context_window] resolves with default model size when no size specified", async () => {
  const { cleanup } = await initTestDbService();
  try {
    ProviderRegistry.clear();
    registerProvider("test-provider");

    const resolver = makeResolver();
    const result = await resolver.resolve({});

    assertEquals(result.provider, "test-provider");
    assertEquals(result.attempt, 1);
  } finally {
    await cleanup();
  }
});

Deno.test("[step132.1][context_window] overflow bumps size tier and emits context_window_overflow", async () => {
  const { cleanup } = await initTestDbService();
  try {
    ProviderRegistry.clear();
    registerProvider("overflow-provider");

    const entry: IModelEntry = {
      provider: "overflow-provider",
      model: "overflow-model",
      capabilities: { minContextWindow: 100000 },
      contextWindow: 100000,
      costPer1kTokens: 0.001,
    };
    const registry: IModelRegistry = {
      getModelsByCapability: () => Promise.resolve([entry]),
      getContextWindow: () => Promise.resolve(500),
      getModelCost: () => Promise.resolve(0),
      getModelPricing: () => Promise.resolve({ provider: "", model: "", provenance: "unknown" }),
      getModelCapability: () => Promise.resolve({}),
      getProviderModels: () => Promise.resolve([entry]),
      getAllProviders: () => Promise.resolve(["overflow-provider"]),
      recordLatency: () => Promise.resolve(),
      getLatencyStats: () => Promise.reject(new Error("not implemented")),
      rankByLatency: () => Promise.reject(new Error("not implemented")),
      recordCall: () => Promise.resolve(),
      getRateLimit: () => Promise.resolve({ remaining: 100, maxRpm: 100, resetAt: 0 }),
      getProviderHealth: () => Promise.resolve(HealthStatus.HEALTHY),
    };
    const logger = createMockEventLogger();
    const resolver = makeResolver(logger, registry);

    const result = await resolver.resolve({
      model_size: "M",
      context_window_fallback: true,
      estimated_input_tokens: 5000,
    });

    assertEquals(result.provider, "overflow-provider");
    const resolvedEvents = logger.events.filter((e) => e.action === "model.resolved");
    const overflow = resolvedEvents.find((e) => e.payload?.reason === "context_window_overflow");
    assertEquals(overflow !== undefined, true, "overflow bump must emit the context_window_overflow reason");
  } finally {
    await cleanup();
  }
});

for (const available of [true, false]) {
  Deno.test(
    available
      ? "a size preset still selects OpenRouter after the deletion, with the lookup available"
      : "with the lookup unavailable, OpenRouter passes the window filter as unknown",
    async () => {
      ProviderRegistry.clear();
      try {
        let contextWindow = 262_144;
        const profile = { M: { min_context_window: 250_000, max_cost_per_mtok: 1, supports_thinking: true } };
        ProviderRegistry.registerWithMetadata("openrouter", new MockProviderFactory(), {
          ...OPENROUTER_PROVIDER_METADATA,
          capabilities: [...OPENROUTER_PROVIDER_METADATA.capabilities],
          pricingTier: PricingTier.MEDIUM,
          modelInfo: () =>
            available
              ? Promise.resolve({ contextWindow, inputPerMtok: 0.02, supportsThinking: true })
              : Promise.reject(new Error("catalog unavailable")),
        });
        assertEquals((await resolvePresetFromSize("M", profile)).provider, "openrouter");
        if (available) {
          contextWindow = 8192;
          await assertRejects(() => resolvePresetFromSize("M", profile), Error, "min_context_window");
        }
      } finally {
        ProviderRegistry.clear();
      }
    },
  );
}
