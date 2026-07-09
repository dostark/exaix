/**
 * @module ModelRegistrySoloCutoverTest
 * @path tests/integration/model_registry_solo_cutover_test.ts
 * @description Phase 134 Step 7 — the Solo cutover proof, in-process and spy-verified.
 *   Drives the same ModelResolver the daemon's agent_executor.resolveModelFromBlueprint
 *   invokes, and asserts the phase's cutover properties without a live daemon:
 *   (1) a curated `model_presets.M.candidates` list resolves with `reason: "preferred_list"`
 *       and performs ZERO `getModelPricing` lookups (D7 + local-first: the preferred-list
 *       path never prices);
 *   (2) a local/non-cheapest preset intent resolves with ZERO pricing lookups;
 *   (3) the edition seam is inert: a resolver constructed WITHOUT a registry (Solo, or
 *       Team with no Team module) resolves byte-identically to one whose registry is
 *       never consulted on the curated path;
 *   (4) the same intent submitted twice returns an identical provider:model (idempotency);
 *   (5) a malformed candidate entry is skipped and resolution falls back to scoring.
 *   Network-zeroing is a design property (documentation-reviewed, no scenario counter);
 *   pricing-lookup-zeroing is the spy-verified stand-in asserted here.
 * @architectural-layer Integration
 * @related-files [packages/ai/src/model_resolver.ts, packages/execution/src/agent_executor.ts, apps/daemon/main.ts]
 * @phase-134 Step 7 cutover — Solo resolution reachable end-to-end, spy-verified.
 */

import { assertEquals } from "@std/assert";
import { PricingTier, ProviderCostTier } from "@exaix/core";
import type { HealthStatus, IModelRegistry } from "@exaix/core/types";
import type { Config, ModelPreset } from "@exaix/schemas";
import { DefaultRoutingStrategy, ModelResolver, ProviderRegistry } from "@exaix/ai";
import { MockProviderFactory } from "../../packages/ai/src/factories/mock_factory.ts";
import { createStubCostTracker, createStubHealthChecker } from "../../packages/ai/tests/helpers/service_stubs.ts";
import { createTestConfig } from "../../packages/ai/tests/helpers/test_config.ts";
import { createMockEventLogger } from "@exaix/testing/helpers/services/barrel.ts";

function registerLocalProvider(name: string): void {
  ProviderRegistry.registerWithMetadata(name, new MockProviderFactory(), {
    name,
    description: name,
    capabilities: ["chat"],
    costTier: ProviderCostTier.LOCAL,
    pricingTier: PricingTier.LOCAL,
    strengths: ["general"],
    contextWindow: 128_000,
  });
}

function permissivePreset(candidates?: string[]): ModelPreset {
  return {
    max_cost_per_mtok: 999,
    min_context_window: 1,
    supports_thinking: false,
    ...(candidates ? { candidates } : {}),
  } as ModelPreset;
}

/** A registry that counts every getModelPricing call so tests can assert zero. */
interface ISpyRegistry extends IModelRegistry {
  pricingCalls: number;
}

function createPricingSpyRegistry(): ISpyRegistry {
  const spy = { pricingCalls: 0 } as ISpyRegistry;
  const base: IModelRegistry = {
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
    getModelPricing: () => {
      spy.pricingCalls++;
      return Promise.resolve({ provider: "", model: "", provenance: "unknown" });
    },
  };
  return Object.assign(spy, base);
}

function makeResolver(config: Config, registry?: IModelRegistry): ModelResolver {
  return new ModelResolver(
    new DefaultRoutingStrategy(ProviderRegistry, createStubCostTracker(), createStubHealthChecker()),
    config,
    createStubHealthChecker(),
    createMockEventLogger(),
    registry,
  );
}

function configWithCandidates(candidates: string[]): Config {
  return {
    ...createTestConfig(),
    model_presets: { S: permissivePreset(), M: permissivePreset(candidates) },
  } as Config;
}

Deno.test({
  name: "[integration] curated list resolves with preferred_list and ZERO pricing lookups (D7 local-first)",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    ProviderRegistry.clear();
    registerLocalProvider("ollama");
    try {
      const logger = createMockEventLogger();
      const registry = createPricingSpyRegistry();
      const resolver = new ModelResolver(
        new DefaultRoutingStrategy(ProviderRegistry, createStubCostTracker(), createStubHealthChecker()),
        configWithCandidates(["ollama"]),
        createStubHealthChecker(),
        logger,
        registry,
      );
      const result = await resolver.resolve({ model_size: "M" });
      assertEquals(result.provider, "ollama");
      const resolved = logger.events.filter((e) => e.action === "model.resolved");
      assertEquals(resolved[0]?.payload?.reason, "preferred_list");
      // The preferred-list path never prices a candidate — this is the spy stand-in for
      // "zero network / zero registry-DB access" on the local-first Solo path.
      assertEquals(registry.pricingCalls, 0);
    } finally {
      ProviderRegistry.clear();
    }
  },
});

Deno.test({
  name: "[integration] a local non-cheapest preset intent resolves with ZERO pricing lookups",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    ProviderRegistry.clear();
    registerLocalProvider("ollama");
    try {
      const registry = createPricingSpyRegistry();
      const resolver = makeResolver(
        { ...createTestConfig(), model_presets: { S: permissivePreset(), M: permissivePreset() } } as Config,
        registry,
      );
      // No `characteristics: ["cheapest"]` → the F1 pricing branch is never entered.
      const result = await resolver.resolve({ model_size: "M", allow_local: true });
      assertEquals(result.provider, "ollama");
      assertEquals(registry.pricingCalls, 0);
    } finally {
      ProviderRegistry.clear();
    }
  },
});

Deno.test({
  name: "[integration] edition seam inert: no-registry resolver resolves byte-identically to Solo",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    ProviderRegistry.clear();
    registerLocalProvider("ollama");
    try {
      const config = configWithCandidates(["ollama"]);
      // "Solo" (registry present, curated path never consults it) vs. "Team with no Team
      // module" (no registry at all) must yield the same provider:model.
      const solo = await makeResolver(config, createPricingSpyRegistry()).resolve({ model_size: "M" });
      const teamNoModule = await makeResolver(config).resolve({ model_size: "M" });
      assertEquals(`${teamNoModule.provider}:${teamNoModule.model}`, `${solo.provider}:${solo.model}`);
    } finally {
      ProviderRegistry.clear();
    }
  },
});

Deno.test({
  name: "[integration] same intent submitted twice returns an identical provider:model (idempotency)",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    ProviderRegistry.clear();
    registerLocalProvider("ollama");
    try {
      const resolver = makeResolver(configWithCandidates(["ollama"]), createPricingSpyRegistry());
      const first = await resolver.resolve({ model_size: "M" });
      const second = await resolver.resolve({ model_size: "M" });
      assertEquals(`${second.provider}:${second.model}`, `${first.provider}:${first.model}`);
    } finally {
      ProviderRegistry.clear();
    }
  },
});

Deno.test({
  name: "[integration] a malformed candidate entry is skipped; resolution falls back to scoring",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    ProviderRegistry.clear();
    registerLocalProvider("ollama");
    try {
      // "does-not-exist" has no provider metadata → skipped in tryResolveCurated; the
      // registered provider still wins via the scoring fallback (daemon would boot).
      const resolver = makeResolver(configWithCandidates(["does-not-exist"]), createPricingSpyRegistry());
      const result = await resolver.resolve({ model_size: "M", allow_local: true });
      assertEquals(result.provider, "ollama");
    } finally {
      ProviderRegistry.clear();
    }
  },
});
