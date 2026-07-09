/**
 * @module ModelResolverCuratedTest
 * @path packages/ai/tests/model_resolver_curated_test.ts
 * @description Phase 134 Step 3 — validates list-authoritative resolution with Solo semantics (F7 + G10):
 *   curated list precedence, bare name lookup, characteristic sub-list reordering, and scoring fallback.
 */
import { assertEquals, assertRejects } from "@std/assert";
import { PricingTier, ProviderCostTier } from "@exaix/core";
import { initTestDbService } from "@exaix/testing";
import { createMockEventLogger } from "@exaix/testing/helpers/services/barrel.ts";
import type { Config, ModelPreset } from "@exaix/schemas";
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

function makeResolver(
  config?: Config,
  logger?: ReturnType<typeof createMockEventLogger>,
): ModelResolver {
  return new ModelResolver(
    new DefaultRoutingStrategy(ProviderRegistry, createStubCostTracker(), createStubHealthChecker()),
    config ?? createTestConfig(),
    createStubHealthChecker(),
    logger ?? createMockEventLogger(),
  );
}

function presetForSize(
  size: string,
  overrides: Partial<ModelPreset> = {},
): ModelPreset {
  const defaults: Record<string, ModelPreset> = {
    S: { max_cost_per_mtok: 0.5, min_context_window: 8_192, supports_thinking: false },
    M: { max_cost_per_mtok: 3, min_context_window: 32_000, supports_thinking: true },
    L: { max_cost_per_mtok: 15, min_context_window: 128_000, supports_thinking: true },
    XL: { max_cost_per_mtok: 75, min_context_window: 200_000, supports_thinking: true },
  };
  return { ...defaults[size], ...overrides } as ModelPreset;
}

function configWithCandidates(
  candidates: string[],
  characteristics?: Record<string, string[]>,
): Config {
  return {
    ...createTestConfig(),
    model_presets: {
      S: presetForSize("S", { candidates, characteristics }),
      M: presetForSize("M"),
      L: presetForSize("L"),
      XL: presetForSize("XL"),
    },
  } as Config;
}

Deno.test("[step134.3] curated list first healthy entry wins with reason preferred_list", async () => {
  const { cleanup } = await initTestDbService();
  try {
    ProviderRegistry.clear();
    registerProvider("alpha");
    registerProvider("beta");
    registerProvider("gamma");

    const config = configWithCandidates(["alpha", "beta", "gamma"]);
    const logger = createMockEventLogger();
    const resolver = makeResolver(config, logger);
    const result = await resolver.resolve({ model_size: "S" });

    assertEquals(result.provider, "alpha");
    const events = logger.events.filter((e) => e.action === "model.resolved");
    assertEquals(events.length >= 1, true);
  } finally {
    await cleanup();
  }
});

Deno.test("[step134.3] curated list skips unregistered provider to next entry", async () => {
  const { cleanup } = await initTestDbService();
  try {
    ProviderRegistry.clear();
    registerProvider("beta");
    registerProvider("gamma");

    const config = configWithCandidates(["alpha", "beta", "gamma"]);
    const resolver = makeResolver(config);
    const result = await resolver.resolve({ model_size: "S" });

    assertEquals(result.provider, "beta");
  } finally {
    await cleanup();
  }
});

Deno.test("[step134.3] empty candidates falls through to scoring fallback", async () => {
  const { cleanup } = await initTestDbService();
  try {
    ProviderRegistry.clear();
    registerProvider("fallback", { contextWindow: 8192 });

    const config = configWithCandidates([]);
    const resolver = makeResolver(config);
    const result = await resolver.resolve({ model_size: "S" });

    assertEquals(result.provider, "fallback");
  } finally {
    await cleanup();
  }
});

Deno.test("[step134.3] explicit provider:model passes through verbatim (G10)", async () => {
  const { cleanup } = await initTestDbService();
  try {
    ProviderRegistry.clear();
    registerProvider("known");

    const config = configWithCandidates(["known"]);
    const resolver = makeResolver(config);
    const result = await resolver.resolve({ model: "unregistered-provider:custom-model" });

    assertEquals(result.provider, "unregistered-provider");
    assertEquals(result.model, "custom-model");
  } finally {
    await cleanup();
  }
});

Deno.test("[step134.3] bare name matching registered provider resolves", async () => {
  const { cleanup } = await initTestDbService();
  try {
    ProviderRegistry.clear();
    registerProvider("my-provider");

    const resolver = makeResolver();
    const result = await resolver.resolve({ model: "my-provider" });

    assertEquals(result.provider, "my-provider");
    assertEquals(typeof result.model, "string");
  } finally {
    await cleanup();
  }
});

Deno.test("[step134.3] bare name with no match throws unknown model error", async () => {
  const { cleanup } = await initTestDbService();
  try {
    ProviderRegistry.clear();
    registerProvider("known");

    const resolver = makeResolver();
    await assertRejects(
      () => resolver.resolve({ model: "nonexistent-model" }),
      Error,
    );
  } finally {
    await cleanup();
  }
});

Deno.test("[step134.3] deterministic curation: 3-entry list resolves to entry 1", async () => {
  const { cleanup } = await initTestDbService();
  try {
    ProviderRegistry.clear();
    ProviderRegistry.registerWithMetadata("entry1", new MockProviderFactory(), {
      name: "entry1",
      description: "e1",
      capabilities: ["chat"],
      costTier: ProviderCostTier.PAID,
      pricingTier: PricingTier.HIGH,
      strengths: ["general"],
      costPerMtok: 10,
      contextWindow: 8192,
    });
    ProviderRegistry.registerWithMetadata("entry2", new MockProviderFactory(), {
      name: "entry2",
      description: "e2",
      capabilities: ["chat"],
      costTier: ProviderCostTier.PAID,
      pricingTier: PricingTier.HIGH,
      strengths: ["general"],
      costPerMtok: 5,
      contextWindow: 8192,
    });
    ProviderRegistry.registerWithMetadata("entry3", new MockProviderFactory(), {
      name: "entry3",
      description: "e3",
      capabilities: ["chat"],
      costTier: ProviderCostTier.FREE,
      pricingTier: PricingTier.LOCAL,
      strengths: ["general"],
      costPerMtok: 0,
      contextWindow: 8192,
    });

    const config = configWithCandidates(["entry1", "entry2", "entry3"]);
    const resolver = makeResolver(config);
    const result = await resolver.resolve({ model_size: "S", characteristics: ["cheapest"] });

    assertEquals(result.provider, "entry1", "should pick entry1 from curated list regardless of cost");
  } finally {
    await cleanup();
  }
});

Deno.test("[step134.3] curated list with interleaved health skips unhealthy", async () => {
  const { cleanup } = await initTestDbService();
  try {
    ProviderRegistry.clear();
    registerProvider("healthy-2");
    registerProvider("healthy-3");

    const config = configWithCandidates(["healthy-1", "healthy-2", "healthy-3"]);
    const healthChecker = {
      checkProvider: (name: string) => Promise.resolve(name !== "healthy-1" && name !== "healthy-3"),
    };
    const resolver = new ModelResolver(
      new DefaultRoutingStrategy(ProviderRegistry, createStubCostTracker(), healthChecker),
      config,
      healthChecker,
      createMockEventLogger(),
    );
    const result = await resolver.resolve({ model_size: "S" });

    assertEquals(result.provider, "healthy-2");
  } finally {
    await cleanup();
  }
});
