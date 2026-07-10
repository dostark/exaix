/**
 * @module ModelResolverCostExemptTest
 * @path packages/ai/tests/model_resolver_cost_exempt_test.ts
 * @description Phase 134 Step 4 — validates D7 local/free cost-exemption behavior:
 *   exempt models skip budget filtering in the routing strategy, get $0 cheapest score,
 *   and don't short-circuit precedence (curated/explicit still win). e2e: a LOCAL provider
 *   resolves through the resolver despite a high daily cost; a PAID one is disqualified.
 */
import { assertEquals, assertRejects } from "@std/assert";
import { PricingTier, ProviderCostTier } from "@exaix/core";
import type { ICostTracker } from "@exaix/core";
import { createMockEventLogger } from "@exaix/testing/helpers/services/barrel.ts";
import type { HealthStatus, IModelRegistry } from "@exaix/core/types";
import type { Config, ModelPreset } from "@exaix/schemas";
import { ProviderRegistry } from "../src/provider_registry.ts";
import { MockProviderFactory } from "../src/factories/mock_factory.ts";
import { DefaultRoutingStrategy } from "../src/routing/default_routing_strategy.ts";
import type { IProviderHealthChecker } from "../src/provider_selector.ts";
import { createStubHealthChecker } from "./helpers/service_stubs.ts";
import { ModelResolver } from "../src/model_resolver.ts";
import { createTestConfig } from "./helpers/test_config.ts";

let uid = 0;
function uniqueName(base: string): string {
  return `${base}-${++uid}`;
}

function registerProvider(
  name: string,
  opts: {
    costTier?: ProviderCostTier;
    costPerMtok?: number;
    supportsThinking?: boolean;
    contextWindow?: number;
  } = {},
): void {
  ProviderRegistry.registerWithMetadata(name, new MockProviderFactory(), {
    name,
    description: name,
    capabilities: ["chat"],
    costTier: opts.costTier ?? ProviderCostTier.PAID,
    pricingTier: PricingTier.LOW,
    strengths: ["general"],
    costPerMtok: opts.costPerMtok,
    supportsThinking: opts.supportsThinking,
    contextWindow: opts.contextWindow,
  });
}

function createHighCostTracker(): ICostTracker {
  return {
    trackGeneration: () => Promise.resolve(1),
    persistEntry: () => Promise.resolve(),
    queryByCriteria: () => Promise.resolve([]),
    getTotalCost: () => 100,
    getDailyCost: () => Promise.resolve(100),
    flush: () => Promise.resolve(),
    isWithinBudget: () => Promise.resolve(false),
  };
}

function createZeroCostTracker(): ICostTracker {
  return {
    trackGeneration: () => Promise.resolve(1),
    persistEntry: () => Promise.resolve(),
    queryByCriteria: () => Promise.resolve([]),
    getTotalCost: () => 0,
    getDailyCost: () => Promise.resolve(0),
    flush: () => Promise.resolve(),
    isWithinBudget: () => Promise.resolve(true),
  };
}

function makeResolver(
  costTracker?: ICostTracker,
  config?: Config,
  modelRegistry?: IModelRegistry,
  healthChecker?: IProviderHealthChecker,
): ModelResolver {
  return new ModelResolver(
    new DefaultRoutingStrategy(
      ProviderRegistry,
      costTracker ?? createHighCostTracker(),
      healthChecker ?? createStubHealthChecker(),
    ),
    config ?? createTestConfig(),
    healthChecker ?? createStubHealthChecker(),
    createMockEventLogger(),
    modelRegistry,
  );
}

function presetForSize(size: string): ModelPreset {
  const defaults: Record<string, ModelPreset> = {
    S: { max_cost_per_mtok: 999, min_context_window: 1, supports_thinking: false },
    M: { max_cost_per_mtok: 999, min_context_window: 1, supports_thinking: false },
  };
  return defaults[size] as ModelPreset;
}

function makeEmptyRegistry(): IModelRegistry {
  return {
    getModelsByCapability: () => Promise.resolve([]),
    getModelCapability: () => Promise.resolve({}),
    getProviderModels: () => Promise.resolve([]),
    getAllProviders: () => Promise.resolve([]),
    getModelCost: () => Promise.resolve(0),
    getContextWindow: () => Promise.resolve(0),
    recordLatency: () => Promise.resolve(),
    getLatencyStats: () => Promise.resolve({ p50Ms: 0, p95Ms: 0, p99Ms: 0, sampleCount: 0, lastUpdated: 0 }),
    rankByLatency: () => Promise.resolve([]),
    recordCall: () => Promise.resolve(),
    getRateLimit: () => Promise.resolve({ remaining: 0, maxRpm: 0, resetAt: 0 }),
    getProviderHealth: () => Promise.resolve("healthy" as HealthStatus),
    getModelPricing: () =>
      Promise.resolve({ provider: "", model: "", inputPerMtok: 0, outputPerMtok: 0, provenance: "unknown" }),
  };
}

/** A registry that counts every getModelPricing call so a test can assert zero. */
interface ISpyRegistry extends IModelRegistry {
  pricingCalls: number;
}

function makePricingSpyRegistry(): ISpyRegistry {
  const spy = { pricingCalls: 0 } as ISpyRegistry;
  return Object.assign(spy, makeEmptyRegistry(), {
    getModelPricing: () => {
      spy.pricingCalls++;
      return Promise.resolve({ provider: "", model: "", inputPerMtok: 0, outputPerMtok: 0, provenance: "unknown" });
    },
  });
}

//
// Routing strategy tests (direct)
//

Deno.test({
  name: "[step134.4] DefaultRoutingStrategy bypasses budget filter for LOCAL provider",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    ProviderRegistry.clear();
    const name = uniqueName("local-route");
    registerProvider(name, {
      costTier: ProviderCostTier.LOCAL,
      costPerMtok: 1,
      contextWindow: 128_000,
    });
    const strategy = new DefaultRoutingStrategy(ProviderRegistry, createHighCostTracker(), createStubHealthChecker());
    const result = await strategy.selectProvider({
      maxCostUsd: 1,
      requiredCapabilities: ["chat"],
    });
    assertEquals(result, name);
  },
});

Deno.test({
  name: "[step134.4] DefaultRoutingStrategy bypasses budget filter for FREE provider",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    ProviderRegistry.clear();
    const name = uniqueName("free-route");
    registerProvider(name, {
      costTier: ProviderCostTier.FREE,
      costPerMtok: 1,
      contextWindow: 128_000,
    });
    const strategy = new DefaultRoutingStrategy(ProviderRegistry, createHighCostTracker(), createStubHealthChecker());
    const result = await strategy.selectProvider({
      maxCostUsd: 1,
      requiredCapabilities: ["chat"],
    });
    assertEquals(result, name);
  },
});

Deno.test({
  name: "[step134.4] DefaultRoutingStrategy disqualifies PAID provider with high daily cost",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    ProviderRegistry.clear();
    registerProvider(uniqueName("paid-route"), {
      costTier: ProviderCostTier.PAID,
      costPerMtok: 1,
      contextWindow: 128_000,
    });
    const strategy = new DefaultRoutingStrategy(ProviderRegistry, createHighCostTracker(), createStubHealthChecker());
    await assertRejects(
      () => strategy.selectProvider({ maxCostUsd: 1, requiredCapabilities: ["chat"] }),
      Error,
    );
  },
});

//
// End-to-end resolver tests (via modelRegistry that returns empty to force resolveOnce path)
//

Deno.test({
  name: "[step134.4] LOCAL provider resolves through resolver with high daily cost (e2e)",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    ProviderRegistry.clear();
    const name = uniqueName("local-e2e");
    registerProvider(name, {
      costTier: ProviderCostTier.LOCAL,
      costPerMtok: 1,
      contextWindow: 128_000,
    });
    const config = {
      ...createTestConfig(),
      model_presets: { S: presetForSize("S"), M: presetForSize("M") },
    } as Config;
    const resolver = makeResolver(undefined, config, makeEmptyRegistry());
    const result = await resolver.resolve({
      model_size: "M",
      max_cost_usd: 1,
      characteristics: ["cheapest"],
    });
    assertEquals(result.provider, name);
  },
});

Deno.test({
  name: "[step134.4] exempt resolution performs zero getModelPricing lookups (spy counter)",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    ProviderRegistry.clear();
    const name = uniqueName("local-spy");
    registerProvider(name, {
      costTier: ProviderCostTier.LOCAL,
      costPerMtok: 1,
      contextWindow: 128_000,
    });
    const config = {
      ...createTestConfig(),
      model_presets: { S: presetForSize("S"), M: presetForSize("M") },
    } as Config;
    const registry = makePricingSpyRegistry();
    const resolver = makeResolver(undefined, config, registry);
    const result = await resolver.resolve({
      model_size: "M",
      max_cost_usd: 1,
      characteristics: ["cheapest"],
    });
    assertEquals(result.provider, name);
    assertEquals(registry.pricingCalls, 0);
  },
});

Deno.test({
  name: "[step134.4] PAID provider fails through resolver with high daily cost (e2e)",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    ProviderRegistry.clear();
    registerProvider(uniqueName("paid-e2e"), {
      costTier: ProviderCostTier.PAID,
      costPerMtok: 1,
      contextWindow: 128_000,
    });
    const config = {
      ...createTestConfig(),
      model_presets: { S: presetForSize("S"), M: presetForSize("M") },
    } as Config;
    const resolver = makeResolver(undefined, config, makeEmptyRegistry());
    await assertRejects(
      () =>
        resolver.resolve({
          model_size: "M",
          max_cost_usd: 1,
          characteristics: ["cheapest"],
        }),
      Error,
    );
  },
});

//
// Scoring test
//

Deno.test({
  name: "[step134.4] cheapest scoring ranks exempt local as $0 over paid with lower metadata costPerMtok",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    ProviderRegistry.clear();
    const cheap = uniqueName("local-zero");
    registerProvider(cheap, {
      costTier: ProviderCostTier.LOCAL,
      costPerMtok: 0,
      contextWindow: 128_000,
    });
    const notSoCheap = uniqueName("paid-low");
    registerProvider(notSoCheap, {
      costTier: ProviderCostTier.PAID,
      costPerMtok: 1,
      contextWindow: 128_000,
    });
    const config = {
      ...createTestConfig(),
      model_presets: { S: presetForSize("S"), M: presetForSize("M") },
    } as Config;
    const resolver = makeResolver(createZeroCostTracker(), config, makeEmptyRegistry());
    const result = await resolver.resolve({
      model_size: "M",
      characteristics: ["cheapest"],
      allow_local: true,
    });
    assertEquals(result.provider, cheap);
  },
});

//
// Precedence test
//

Deno.test({
  name: "[step134.4] exempt does not jump precedence over curated list (D7 no-short-circuit)",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    ProviderRegistry.clear();
    const curated = uniqueName("curated-provider");
    const exempt = uniqueName("exempt-provider");
    registerProvider(curated, {
      costTier: ProviderCostTier.PAID,
      costPerMtok: 1,
      contextWindow: 128_000,
    });
    registerProvider(exempt, {
      costTier: ProviderCostTier.LOCAL,
      costPerMtok: 0,
      contextWindow: 128_000,
    });
    const config = {
      ...createTestConfig(),
      model_presets: {
        S: presetForSize("S"),
        M: { ...presetForSize("M"), candidates: [curated] },
      },
    } as Config;
    const resolver = makeResolver(createZeroCostTracker(), config);
    const result = await resolver.resolve({ model_size: "M", allow_local: true });
    assertEquals(result.provider, curated);
  },
});
