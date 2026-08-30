/**
 * @module ModelResolverRegistryTest
 * @path packages/ai/tests/model_resolver_registry_test.ts
 * @description Phase 134 Step 2 — validates registry-backed model resolution: preset resolution
 *   delegates to IModelRegistry when present, overflow uses registry getContextWindow,
 *   behavior is byte-identical without registry.
 */
import { assertEquals } from "@std/assert";
import { PricingTier, ProviderCostTier } from "@exaix/core";
import type { ICapabilityProfile, IModelEntry, IModelRegistry } from "@exaix/core/types";
import { HealthStatus } from "@exaix/core/types";
import { initTestDbService, withEnv } from "@exaix/testing";
import { createMockEventLogger } from "@exaix/testing/helpers/services/barrel.ts";
import { ProviderRegistry } from "../src/provider_registry.ts";
import { MockProviderFactory } from "../src/factories/mock_factory.ts";
import { DefaultRoutingStrategy } from "../src/routing/default_routing_strategy.ts";
import { createStubCostTracker, createStubHealthChecker } from "./helpers/service_stubs.ts";
import { ModelResolver } from "../src/model_resolver.ts";
import { createTestConfig } from "./helpers/test_config.ts";

function registerProvider(
  name: string,
  opts: { costPerMtok?: number; supportsThinking?: boolean; contextWindow?: number } = {},
): void {
  ProviderRegistry.registerWithMetadata(name, new MockProviderFactory(), {
    name,
    description: name,
    capabilities: ["chat"],
    costTier: ProviderCostTier.FREE,
    pricingTier: PricingTier.LOCAL,
    strengths: ["general"],
    costPerMtok: opts.costPerMtok,
    supportsThinking: opts.supportsThinking,
    contextWindow: opts.contextWindow,
  });
}

function stubModelRegistry(
  models?: IModelEntry[],
  contextWindow?: number,
): IModelRegistry {
  const entries = models ?? [];
  const baseCtx = contextWindow ?? 32000;
  return {
    getModelsByCapability: (_profile: ICapabilityProfile) => Promise.resolve(entries),
    getContextWindow: (_provider: string, _model: string) => Promise.resolve(baseCtx),
    getModelCost: () => Promise.resolve(0),
    getModelPricing: () => Promise.resolve({ provider: "", model: "", provenance: "unknown" }),
    getModelCapability: () => Promise.resolve({}),
    getProviderModels: () => Promise.resolve([]),
    getAllProviders: () => Promise.resolve([]),
    recordLatency: () => Promise.resolve(),
    getLatencyStats: () => Promise.reject(new Error("not implemented")),
    rankByLatency: () => Promise.reject(new Error("not implemented")),
    recordCall: () => Promise.resolve(),
    getRateLimit: () => Promise.resolve({ remaining: 100, maxRpm: 100, resetAt: 0 }),
    getProviderHealth: () => Promise.resolve(HealthStatus.HEALTHY),
  };
}

function makeResolver(
  registry?: IModelRegistry,
  logger?: ReturnType<typeof createMockEventLogger>,
): ModelResolver {
  return new ModelResolver(
    new DefaultRoutingStrategy(ProviderRegistry, createStubCostTracker(), createStubHealthChecker()),
    createTestConfig(),
    createStubHealthChecker(),
    logger ?? createMockEventLogger(),
    registry,
  );
}

Deno.test("[step134.2] preset resolution uses registry when present", async () => {
  const { cleanup } = await initTestDbService();
  try {
    ProviderRegistry.clear();
    registerProvider("other-provider");

    const registry = stubModelRegistry([
      {
        provider: "registry-provider",
        model: "registry-model",
        capabilities: { minContextWindow: 32000 },
        contextWindow: 32000,
        costPer1kTokens: 0.001,
      },
    ]);
    const resolver = makeResolver(registry);
    const result = await resolver.resolve({ model_size: "M" });

    assertEquals(result.provider, "registry-provider");
    assertEquals(result.model, "registry-model");
    assertEquals(result.attempt, 1);
  } finally {
    await cleanup();
  }
});

Deno.test("[step134.2] preset resolution unchanged without registry", async () => {
  const { cleanup } = await initTestDbService();
  try {
    ProviderRegistry.clear();
    registerProvider("legacy-provider", { contextWindow: 8192 });

    const resolver = makeResolver();
    const result = await resolver.resolve({ model_size: "S" });

    assertEquals(result.provider, "legacy-provider");
    assertEquals(result.model.length > 0, true);
  } finally {
    await cleanup();
  }
});

Deno.test("[step134.2] overflow uses registry getContextWindow and bumps a size tier", async () => {
  const { cleanup } = await initTestDbService();
  try {
    ProviderRegistry.clear();
    registerProvider("overflow-provider");

    const registry = stubModelRegistry(
      [
        {
          provider: "overflow-provider",
          model: "overflow-model",
          capabilities: { minContextWindow: 8192 },
          contextWindow: 8192,
          costPer1kTokens: 0.001,
        },
      ],
      1000,
    );
    const logger = createMockEventLogger();
    const resolver = makeResolver(registry, logger);
    const result = await resolver.resolve({
      model_size: "S",
      context_window_fallback: true,
      estimated_input_tokens: 5000,
    });

    assertEquals(result.provider, "overflow-provider");
    assertEquals(typeof result.model, "string");
    assertEquals(result.attempt, 1);

    const resolvedEvents = logger.events.filter((e) => e.action === "model.resolved");
    const overflow = resolvedEvents.find((e) => e.payload?.reason === "context_window_overflow");
    assertEquals(
      overflow !== undefined,
      true,
      "5000 input tokens over a 1000-token window must trigger the S→M bump, not resolve silently",
    );
  } finally {
    await cleanup();
  }
});

Deno.test("[step134.2] trace includes registry candidates", async () => {
  const { cleanup } = await initTestDbService();
  try {
    ProviderRegistry.clear();
    registerProvider("other-provider");

    const registry = stubModelRegistry([
      {
        provider: "trace-provider",
        model: "trace-model",
        capabilities: { minContextWindow: 32000 },
        contextWindow: 32000,
        costPer1kTokens: 0.001,
      },
    ]);
    const logger = createMockEventLogger();
    const resolver = makeResolver(registry, logger);
    await resolver.resolve({ model_size: "M", characteristics: ["cheapest"] });

    const events = logger.events.filter((e) => e.action === "model.resolved");
    assertEquals(events.length >= 1, true);

    const last = events[events.length - 1];
    assertEquals(last.target, "trace-model");
  } finally {
    await cleanup();
  }
});

Deno.test("[step134.2] empty registry model set falls through to scoring path", async () => {
  const { cleanup } = await initTestDbService();
  try {
    ProviderRegistry.clear();
    registerProvider("fallback-provider");

    const registry = stubModelRegistry([]);
    const resolver = makeResolver(registry);

    const result = await resolver.resolve({ model_size: "XL" });

    assertEquals(result.provider, "fallback-provider");
    assertEquals(typeof result.model, "string");
    assertEquals(result.model.length > 0, true);
  } finally {
    await cleanup();
  }
});

Deno.test("[step134.2] EXA_MODEL_PRESET_OVERRIDE still wins over the registry path (G2 step 0)", async () => {
  const { cleanup } = await initTestDbService();
  try {
    ProviderRegistry.clear();
    registerProvider("other-provider");
    const registry = stubModelRegistry([
      {
        provider: "registry-provider",
        model: "registry-model",
        capabilities: { minContextWindow: 32000 },
        contextWindow: 32000,
        costPer1kTokens: 0.001,
      },
    ]);
    const resolver = makeResolver(registry);
    await withEnv({ EXA_MODEL_PRESET_OVERRIDE: "test" }, async () => {
      const result = await resolver.resolve({ model_size: "M" });
      // The override map wins over the registry — never resolves to the registry model.
      assertEquals(result.provider !== "registry-provider", true);
      assertEquals(result.model !== "registry-model", true);
    });
  } finally {
    await cleanup();
  }
});

Deno.test("[step134.2] registry getModelsByCapability throwing falls through to Phase 132 scoring (resilience)", async () => {
  const { cleanup } = await initTestDbService();
  try {
    ProviderRegistry.clear();
    registerProvider("resilient-provider");

    const throwing = stubModelRegistry();
    throwing.getModelsByCapability = () => Promise.reject(new Error("registry unavailable"));
    const resolver = makeResolver(throwing);

    // A throwing registry must NOT crash resolution — it degrades to capability scoring instead.
    const result = await resolver.resolve({ model_size: "M" });
    assertEquals(result.provider, "resilient-provider");
    assertEquals(result.model.length > 0, true);
  } finally {
    await cleanup();
  }
});

Deno.test("[step134.2] same intent resolved twice returns the same provider:model (re-resolution stability)", async () => {
  const { cleanup } = await initTestDbService();
  try {
    ProviderRegistry.clear();
    registerProvider("stable-provider");
    const registry = stubModelRegistry([
      {
        provider: "stable-registry",
        model: "stable-model",
        capabilities: { minContextWindow: 32000 },
        contextWindow: 32000,
        costPer1kTokens: 0.001,
      },
    ]);
    const resolver = makeResolver(registry);
    const a = await resolver.resolve({ model_size: "M" });
    const b = await resolver.resolve({ model_size: "M" });
    assertEquals(a.provider, b.provider);
    assertEquals(a.model, b.model);
  } finally {
    await cleanup();
  }
});

Deno.test("[step134.2] cheapest prefers a known-priced registry model over an unknown-priced one (F1)", async () => {
  const { cleanup } = await initTestDbService();
  try {
    ProviderRegistry.clear();
    registerProvider("f1-provider");
    // First entry is unknown-priced; second is genuinely $0-known. F1: the unknown-priced
    // model must not win `cheapest` — a known price is required to rank cheapest.
    const registry = stubModelRegistry([
      {
        provider: "unknown-priced",
        model: "unknown-model",
        capabilities: { minContextWindow: 32000 },
        contextWindow: 32000,
        costPer1kTokens: 0,
      },
      {
        provider: "known-cheap",
        model: "known-model",
        capabilities: { minContextWindow: 32000 },
        contextWindow: 32000,
        costPer1kTokens: 0,
      },
    ]);
    registry.getModelPricing = (provider: string, model: string) =>
      Promise.resolve(
        provider === "known-cheap"
          ? { provider, model, inputPerMtok: 0, provenance: "static" as const }
          : { provider, model, provenance: "unknown" as const },
      );
    const resolver = makeResolver(registry);
    const result = await resolver.resolve({ model_size: "M", characteristics: ["cheapest"] });
    // The unknown-priced first entry is excluded from cheapest → the known-priced one wins.
    assertEquals(result.provider, "known-cheap");
    assertEquals(result.model, "known-model");
  } finally {
    await cleanup();
  }
});
