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
import { type IProviderMetadata, ProviderRegistry } from "../src/provider_registry.ts";
import type { Opt, Reason } from "@exaix/core/types";
import { MockProviderFactory } from "../src/factories/mock_factory.ts";
import { DefaultRoutingStrategy } from "../src/routing/default_routing_strategy.ts";
import { createStubCostTracker, createStubHealthChecker } from "./helpers/service_stubs.ts";
import { ModelResolver } from "../src/model_resolver.ts";
import { createTestConfig } from "./helpers/test_config.ts";
import { DefaultModelRegistry } from "@exaix/model-registry";
import { DEFAULT_MODEL_PRESETS } from "@exaix/schemas";

function registerProvider(
  name: string,
  opts: {
    tier?: PricingTier;
    costTier?: ProviderCostTier;
    costPerMtok?: number;
    modelInfo?: IProviderMetadata["modelInfo"];
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
    modelInfo: opts.modelInfo,
  });
}

function makeResolver(logger?: Opt<ReturnType<typeof createMockEventLogger>, Reason.OptionalContext>): ModelResolver {
  return new ModelResolver(
    new DefaultRoutingStrategy(ProviderRegistry, createStubCostTracker(), createStubHealthChecker()),
    createTestConfig(),
    createStubHealthChecker(),
    logger ?? createMockEventLogger(),
  );
}

Deno.test("cheapest ranks OpenRouter by its per-model price", async () => {
  ProviderRegistry.clear();
  const models: string[] = [];
  try {
    registerProvider("competitor", { costPerMtok: 1 });
    registerProvider("openrouter", {
      costPerMtok: 3,
      modelInfo: (model) => {
        models.push(model);
        return Promise.resolve({ inputPerMtok: 0.02 });
      },
    });
    assertEquals((await makeResolver().resolve({ characteristics: ["cheapest"] })).provider, "openrouter");
    assertEquals(models, ["openrouter-model"]);
  } finally {
    ProviderRegistry.clear();
  }
});

Deno.test("an unknown per-model price ranks last, not first", async () => {
  ProviderRegistry.clear();
  try {
    registerProvider("openrouter", { modelInfo: () => Promise.resolve(undefined) });
    registerProvider("priced", { costPerMtok: 1 });
    const logger = createMockEventLogger();
    const result = await makeResolver(logger).resolve({ characteristics: ["cheapest"] });
    assertEquals(result.provider, "priced");
    const scores = logger.events.find((event) => event.action === "model.resolved")?.payload?.scores;
    assertEquals(typeof scores, "object");
  } finally {
    ProviderRegistry.clear();
  }
});

Deno.test("cheapest ranks per-model prices on the Solo registry preset path", async () => {
  ProviderRegistry.clear();
  try {
    registerProvider("competitor", {
      costPerMtok: 1,
      modelInfo: () => Promise.resolve({ inputPerMtok: 1, contextWindow: 262_144 }),
    });
    registerProvider("openrouter", {
      costPerMtok: 3,
      modelInfo: () => Promise.resolve({ inputPerMtok: 0.02, contextWindow: 262_144 }),
    });
    const health = createStubHealthChecker();
    const config = createTestConfig();
    config.model_presets = {
      ...DEFAULT_MODEL_PRESETS,
      M: { min_context_window: 8192, max_cost_per_mtok: 100, supports_thinking: false },
    };
    const resolver = new ModelResolver(
      new DefaultRoutingStrategy(ProviderRegistry, createStubCostTracker(), health),
      config,
      health,
      createMockEventLogger(),
      new DefaultModelRegistry(health),
    );
    assertEquals((await resolver.resolve({ model_size: "M", characteristics: ["cheapest"] })).provider, "openrouter");
  } finally {
    ProviderRegistry.clear();
  }
});

Deno.test("Solo registry treats output-only prices as unknown for cheapest input ranking", async () => {
  ProviderRegistry.clear();
  try {
    registerProvider("openrouter", { modelInfo: () => Promise.resolve({ outputPerMtok: 15, contextWindow: 262_144 }) });
    registerProvider("competitor", { modelInfo: () => Promise.resolve({ inputPerMtok: 1, contextWindow: 262_144 }) });
    const health = createStubHealthChecker();
    const config = createTestConfig();
    config.model_presets = {
      ...DEFAULT_MODEL_PRESETS,
      M: { min_context_window: 8192, max_cost_per_mtok: 100, supports_thinking: false },
    };
    const resolver = new ModelResolver(
      new DefaultRoutingStrategy(ProviderRegistry, createStubCostTracker(), health),
      config,
      health,
      createMockEventLogger(),
      new DefaultModelRegistry(health),
    );
    assertEquals((await resolver.resolve({ model_size: "M", characteristics: ["cheapest"] })).provider, "competitor");
  } finally {
    ProviderRegistry.clear();
  }
});

Deno.test("cheapest uses a provider fallback after a rejected model lookup and preserves a zero catalog price", async () => {
  ProviderRegistry.clear();
  try {
    registerProvider("fallback", { costPerMtok: 1, modelInfo: () => Promise.reject(new Error("unavailable")) });
    registerProvider("openrouter", { costPerMtok: 3, modelInfo: () => Promise.resolve({ inputPerMtok: 0 }) });
    assertEquals((await makeResolver().resolve({ characteristics: ["cheapest"] })).provider, "openrouter");
  } finally {
    ProviderRegistry.clear();
  }
});

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
    const scores = traceEvents[0].payload?.scores as Record<string, number> | undefined ?? {};
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

Deno.test("[step135.8][GAP-C] cheapest characteristic score decides the resolved provider, not just the trace", async () => {
  const { cleanup } = await initTestDbService();
  try {
    ProviderRegistry.clear();
    // Register in an order where the DEFAULT selector (no scoring influence) would
    // otherwise pick "expensive" first (registration/filter order), proving the score
    // — not incidental ordering — decided the outcome.
    registerProvider("expensive", { costPerMtok: 100 });
    registerProvider("cheap", { costPerMtok: 1 });

    const resolver = makeResolver();
    const result = await resolver.resolve({ characteristics: ["cheapest"] });

    assertEquals(result.provider, "cheap");
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
