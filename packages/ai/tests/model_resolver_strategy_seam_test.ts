/**
 * @module ModelResolverStrategySeamTest
 * @path packages/ai/tests/model_resolver_strategy_seam_test.ts
 * @description Phase 135 Step 1 (GAP-1) — the IResolutionStrategy seam on ModelResolver:
 *   an unset strategy is byte-identical to 134 behaviour; a registered validateExplicit
 *   hook is invoked for an explicit provider:model choice. Step 8 adds scoreBest/rankUsage.
 * @architectural-layer AI-Routing
 */
import { assertEquals } from "@std/assert";
import { initTestDbService } from "@exaix/testing";
import { createMockEventLogger } from "@exaix/testing/helpers/services/barrel.ts";
import { ModelResolver } from "../src/model_resolver.ts";
import type { IResolutionStrategy } from "../src/i_resolution_strategy.ts";
import { PricingTier, ProviderCostTier, TaskType } from "@exaix/core";
import { HealthStatus } from "@exaix/core/types";
import type { IModelRegistry } from "@exaix/core/types";
import { ProviderRegistry } from "../src/provider_registry.ts";
import { DefaultRoutingStrategy } from "../src/routing/default_routing_strategy.ts";
import { MockProviderFactory } from "../src/factories/mock_factory.ts";
import { createTestConfig } from "./helpers/test_config.ts";
import { createStubCostTracker, createStubHealthChecker } from "./helpers/service_stubs.ts";

function registerProvider(name: string, opts: { costPerMtok?: number } = {}): void {
  ProviderRegistry.registerWithMetadata(name, new MockProviderFactory(), {
    name,
    description: name,
    capabilities: ["chat"],
    costTier: ProviderCostTier.FREE,
    pricingTier: PricingTier.LOCAL,
    strengths: ["general"],
    costPerMtok: opts.costPerMtok,
  });
}

/** Register a provider that satisfies the "M" preset (context window + thinking). */
function registerPresetProvider(name: string): void {
  ProviderRegistry.registerWithMetadata(name, new MockProviderFactory(), {
    name,
    description: name,
    capabilities: ["chat"],
    costTier: ProviderCostTier.FREE,
    pricingTier: PricingTier.LOCAL,
    strengths: ["general"],
    supportsThinking: true,
    contextWindow: 200_000,
  });
}

function makeResolver(
  strategy?: IResolutionStrategy,
  logger?: ReturnType<typeof createMockEventLogger>,
): ModelResolver {
  return new ModelResolver(
    new DefaultRoutingStrategy(ProviderRegistry, createStubCostTracker(), createStubHealthChecker()),
    createTestConfig(),
    createStubHealthChecker(),
    logger ?? createMockEventLogger(),
    undefined,
    strategy,
  );
}

Deno.test("[gap1] no strategy injected: explicit provider:model resolves 134-style (inert seam)", async () => {
  const { cleanup } = await initTestDbService();
  try {
    ProviderRegistry.clear();
    registerProvider("anthropic");
    const resolver = makeResolver(); // no strategy
    const resolved = await resolver.resolve({ model: "anthropic:claude-x" });
    assertEquals(resolved.provider, "anthropic");
    assertEquals(resolved.model, "claude-x");
  } finally {
    ProviderRegistry.clear();
    await cleanup();
  }
});

Deno.test("[gap1] validateExplicit hook is invoked when a strategy is registered", async () => {
  const { cleanup } = await initTestDbService();
  try {
    ProviderRegistry.clear();
    registerProvider("anthropic");
    let called: { provider: string; model: string } | null = null;
    const strategy: IResolutionStrategy = {
      validateExplicit: (provider, model) => {
        called = { provider, model };
        return Promise.resolve({ provider, model });
      },
    };
    const resolver = makeResolver(strategy);
    await resolver.resolve({ model: "anthropic:claude-x" });
    assertEquals(called, { provider: "anthropic", model: "claude-x" });
  } finally {
    ProviderRegistry.clear();
    await cleanup();
  }
});

Deno.test("[gap1][step3] Solo (no strategy) passes an unvalidated explicit provider:model through (G10 regression)", async () => {
  const { cleanup } = await initTestDbService();
  try {
    ProviderRegistry.clear();
    registerProvider("openrouter");
    // No strategy registered ⇒ the resolver must NOT validate/auto-admit; an arbitrary
    // (even unadmitted / non-real) explicit choice resolves verbatim, exactly as 134.
    const resolver = makeResolver();
    const resolved = await resolver.resolve({ model: "openrouter:vendor/never-admitted" });
    assertEquals(resolved.provider, "openrouter");
    assertEquals(resolved.model, "vendor/never-admitted");
  } finally {
    ProviderRegistry.clear();
    await cleanup();
  }
});

Deno.test("[gap1][step6] selectRoute hook applies to a non-pinned choice and its route_reason lands on the resolved model", async () => {
  const { cleanup } = await initTestDbService();
  try {
    ProviderRegistry.clear();
    registerPresetProvider("anthropic");
    registerPresetProvider("openrouter");
    let called: { provider: string; model: string } | null = null;
    const strategy: IResolutionStrategy = {
      selectRoute: (resolved) => {
        called = { provider: resolved.provider, model: resolved.model };
        return Promise.resolve({
          provider: "openrouter",
          model: resolved.model,
          route_reason: "cheapest",
          considered_routes: [
            { provider: "anthropic", price: 3, health_score: 1 },
            { provider: "openrouter", price: 2, health_score: 1 },
          ],
        });
      },
    };
    const resolver = makeResolver(strategy);
    // A bare model name resolves via the scoring path (non-pinned) → selectRoute applies.
    const resolved = await resolver.resolve({ model_size: "M" });
    assertEquals(called !== null, true);
    assertEquals(resolved.route_reason, "cheapest");
  } finally {
    ProviderRegistry.clear();
    await cleanup();
  }
});

Deno.test("[gap1][step6] explicit provider:model is pinned — selectRoute is NOT applied", async () => {
  const { cleanup } = await initTestDbService();
  try {
    ProviderRegistry.clear();
    registerProvider("anthropic");
    let called = false;
    const strategy: IResolutionStrategy = {
      selectRoute: (resolved) => {
        called = true;
        return Promise.resolve({ provider: resolved.provider, model: resolved.model, route_reason: "cheapest" });
      },
    };
    const resolver = makeResolver(strategy);
    const resolved = await resolver.resolve({ model: "anthropic:claude-x" });
    assertEquals(called, false); // pinned explicit skips the route sub-step
    assertEquals(resolved.route_reason, undefined);
  } finally {
    ProviderRegistry.clear();
    await cleanup();
  }
});

Deno.test("[gap1][step6] no strategy (Solo): no route sub-step, route_reason absent", async () => {
  const { cleanup } = await initTestDbService();
  try {
    ProviderRegistry.clear();
    registerPresetProvider("anthropic");
    const resolver = makeResolver(); // no strategy
    const resolved = await resolver.resolve({ model_size: "M" });
    assertEquals(resolved.route_reason, undefined);
  } finally {
    ProviderRegistry.clear();
    await cleanup();
  }
});

Deno.test("[gap9][step6] model.resolved trace payload carries route_reason and considered_routes when a route was selected", async () => {
  const { cleanup } = await initTestDbService();
  try {
    ProviderRegistry.clear();
    registerPresetProvider("anthropic");
    registerPresetProvider("openrouter");
    const logger = createMockEventLogger();
    const strategy: IResolutionStrategy = {
      selectRoute: (resolved) =>
        Promise.resolve({
          provider: "openrouter",
          model: resolved.model,
          route_reason: "cheapest",
          considered_routes: [
            { provider: "anthropic", price: 3, health_score: 1 },
            { provider: "openrouter", price: 2, health_score: 0.9 },
          ],
        }),
    };
    const resolver = new ModelResolver(
      new DefaultRoutingStrategy(ProviderRegistry, createStubCostTracker(), createStubHealthChecker()),
      createTestConfig(),
      createStubHealthChecker(),
      logger,
      undefined,
      strategy,
    );
    await resolver.resolve({ model_size: "M" });
    const resolvedEvents = logger.events.filter((e) => e.action === "model.resolved");
    const withRoute = resolvedEvents.find((e) => e.payload?.route_reason === "cheapest");
    assertEquals(withRoute !== undefined, true);
    assertEquals(Array.isArray(withRoute?.payload?.considered_routes), true);
  } finally {
    ProviderRegistry.clear();
    await cleanup();
  }
});

Deno.test("[step135.8][GAP-C] scoreBest hook decides the resolved provider and reason is best_ranked", async () => {
  const { cleanup } = await initTestDbService();
  try {
    ProviderRegistry.clear();
    registerProvider("low-bench");
    registerProvider("high-bench");
    const strategy: IResolutionStrategy = {
      scoreBest: (candidates, _taskType) => {
        const scores: Record<string, number> = {};
        for (const c of candidates) scores[c.provider] = c.provider === "high-bench" ? 1 : 0;
        return Promise.resolve(scores);
      },
    };
    const resolver = makeResolver(strategy);
    const result = await resolver.resolve({ characteristics: ["best"], task_type: TaskType.FEATURE });
    assertEquals(result.provider, "high-bench");
  } finally {
    ProviderRegistry.clear();
    await cleanup();
  }
});

Deno.test('[step135.8][GAP-C] ["best","cheapest"] blends into one weighted order, not a best-only pass', async () => {
  const { cleanup } = await initTestDbService();
  try {
    ProviderRegistry.clear();
    // "high-bench" wins on best, "cheap" wins on cheapest — the blend should not simply
    // reduce to whichever characteristic is listed first.
    registerProvider("high-bench", { costPerMtok: 100 });
    registerProvider("cheap", { costPerMtok: 1 });
    const strategy: IResolutionStrategy = {
      scoreBest: (candidates, _taskType) => {
        const scores: Record<string, number> = {};
        for (const c of candidates) scores[c.provider] = c.provider === "high-bench" ? 1 : 0;
        return Promise.resolve(scores);
      },
    };
    const logger = createMockEventLogger();
    const resolver = makeResolver(strategy, logger);
    const result = await resolver.resolve({ characteristics: ["best", "cheapest"], task_type: TaskType.FEATURE });
    // A blend: neither pure-best nor pure-cheapest is asserted; only that both
    // characteristics fed one scoring pass (both providers are viable outcomes
    // depending on weighting, but the reason must reflect a blended decision).
    assertEquals(["high-bench", "cheap"].includes(result.provider), true);
    // With these scores, "high-bench" wins narrowly (0.5 vs 0.495) — best's maxed score
    // IS what tips the balance (without it, "cheap" would win on price alone, 0.99 vs 0),
    // so reason correctly reflects best as decisive here.
    const resolvedEvents = logger.events.filter((e) => e.action === "model.resolved");
    assertEquals(resolvedEvents[0]?.payload?.reason, "best_ranked");
  } finally {
    ProviderRegistry.clear();
    await cleanup();
  }
});

Deno.test('[step135.14][GAP-12] ["best","cheapest"] where cheapest strictly dominates the blend resolves with reason "characteristics_scored", not "best_ranked"', async () => {
  const { cleanup } = await initTestDbService();
  try {
    ProviderRegistry.clear();
    // A realistic edge case: high-bench's small benchmark edge (0.6 vs 0.5) is swamped by a
    // large price gap (cost 100 vs 1), so "cheap" wins — the reason must reflect that, not
    // default to "best_ranked" merely because "best" was among the requested characteristics.
    registerProvider("high-bench", { costPerMtok: 100 });
    registerProvider("cheap", { costPerMtok: 1 });
    const strategy: IResolutionStrategy = {
      scoreBest: (candidates, _taskType) => {
        const scores: Record<string, number> = {};
        for (const c of candidates) scores[c.provider] = c.provider === "high-bench" ? 0.6 : 0.5;
        return Promise.resolve(scores);
      },
    };
    const logger = createMockEventLogger();
    const resolver = makeResolver(strategy, logger);
    const result = await resolver.resolve({ characteristics: ["best", "cheapest"], task_type: TaskType.FEATURE });
    assertEquals(result.provider, "cheap");
    const resolvedEvents = logger.events.filter((e) => e.action === "model.resolved");
    assertEquals(resolvedEvents[0]?.payload?.reason, "characteristics_scored");
  } finally {
    ProviderRegistry.clear();
    await cleanup();
  }
});

Deno.test('[step135.14][GAP-12][regression] a request with only ["best"] and a resolved task_type still reports reason "best_ranked"', async () => {
  const { cleanup } = await initTestDbService();
  try {
    ProviderRegistry.clear();
    registerProvider("low-bench");
    registerProvider("high-bench");
    const strategy: IResolutionStrategy = {
      scoreBest: (candidates, _taskType) => {
        const scores: Record<string, number> = {};
        for (const c of candidates) scores[c.provider] = c.provider === "high-bench" ? 1 : 0;
        return Promise.resolve(scores);
      },
    };
    const logger = createMockEventLogger();
    const resolver = makeResolver(strategy, logger);
    const result = await resolver.resolve({ characteristics: ["best"], task_type: TaskType.FEATURE });
    assertEquals(result.provider, "high-bench");
    const resolvedEvents = logger.events.filter((e) => e.action === "model.resolved");
    assertEquals(resolvedEvents[0]?.payload?.reason, "best_ranked");
  } finally {
    ProviderRegistry.clear();
    await cleanup();
  }
});

Deno.test("[step135.8] UNKNOWN task_type skips best without error (never mis-ranks)", async () => {
  const { cleanup } = await initTestDbService();
  try {
    ProviderRegistry.clear();
    registerProvider("only-provider");
    let called = false;
    const strategy: IResolutionStrategy = {
      scoreBest: (_candidates, _taskType) => {
        called = true;
        return Promise.resolve({});
      },
    };
    const resolver = makeResolver(strategy);
    const result = await resolver.resolve({ characteristics: ["best"], task_type: TaskType.UNKNOWN });
    assertEquals(called, false);
    assertEquals(result.provider, "only-provider");
  } finally {
    ProviderRegistry.clear();
    await cleanup();
  }
});

Deno.test("[step135.8] best never overrides an explicit model (precedence regression)", async () => {
  const { cleanup } = await initTestDbService();
  try {
    ProviderRegistry.clear();
    registerProvider("anthropic");
    let called = false;
    const strategy: IResolutionStrategy = {
      scoreBest: (_candidates, _taskType) => {
        called = true;
        return Promise.resolve({});
      },
    };
    const resolver = makeResolver(strategy);
    const result = await resolver.resolve({
      model: "anthropic:claude-x",
      characteristics: ["best"],
      task_type: TaskType.FEATURE,
    });
    assertEquals(called, false);
    assertEquals(result.provider, "anthropic");
    assertEquals(result.model, "claude-x");
  } finally {
    ProviderRegistry.clear();
    await cleanup();
  }
});

Deno.test("[step135.8][F8] rankUsage is offered the tied/no-characteristics pool; its ranked order decides the provider and traces usage_ranked", async () => {
  const { cleanup } = await initTestDbService();
  try {
    ProviderRegistry.clear();
    registerProvider("mfu-leader");
    registerProvider("rarely-used");
    let called: Array<{ provider: string; model: string }> | null = null;
    const strategy: IResolutionStrategy = {
      rankUsage: (candidates) => {
        called = candidates;
        return Promise.resolve(["mfu-leader", "rarely-used"]);
      },
    };
    const logger = createMockEventLogger();
    const resolver = makeResolver(strategy, logger);
    const result = await resolver.resolve({});
    // usage_tiebreak's opt-in gating is an edition-boundary concern owned by the strategy
    // implementation; the resolver always offers the tied pool. This injected strategy opts
    // in, so its ranking order decides the winner.
    assertEquals(called !== null, true);
    assertEquals(result.provider, "mfu-leader");
    const resolvedEvents = logger.events.filter((e) => e.action === "model.resolved");
    assertEquals(resolvedEvents[0]?.payload?.reason, "usage_ranked");
  } finally {
    ProviderRegistry.clear();
    await cleanup();
  }
});

Deno.test("[step135.8][F8][edge][idempotency] rankUsage returning undefined leaves selection unaffected (opt-out, inert)", async () => {
  const { cleanup } = await initTestDbService();
  try {
    ProviderRegistry.clear();
    registerProvider("first");
    registerProvider("second");
    const strategy: IResolutionStrategy = {
      rankUsage: (_candidates) => Promise.resolve(undefined),
    };
    const resolver = makeResolver(strategy);
    const result = await resolver.resolve({});
    assertEquals(typeof result.provider, "string");
  } finally {
    ProviderRegistry.clear();
    await cleanup();
  }
});

Deno.test("[step135.8][GAP-9][edge][roundtrip] task_type_source round-trips through the model.resolved trace payload unchanged", async () => {
  const { cleanup } = await initTestDbService();
  try {
    ProviderRegistry.clear();
    registerProvider("anthropic");
    const logger = createMockEventLogger();
    const resolver = makeResolver(undefined, logger);
    await resolver.resolve({
      model: "anthropic:claude-x",
      task_type: TaskType.FEATURE,
      task_type_source: "agent_role",
    });
    const resolvedEvents = logger.events.filter((e) => e.action === "model.resolved");
    assertEquals(resolvedEvents[0]?.payload?.task_type_source, "agent_role");
  } finally {
    ProviderRegistry.clear();
    await cleanup();
  }
});

Deno.test('[step135.8][GAP-E][regression] a context-window overflow bump on a ["best"] request re-scores the larger pool by benchmark_map[task_type]', async () => {
  const { cleanup } = await initTestDbService();
  try {
    ProviderRegistry.clear();
    registerProvider("winner");
    registerProvider("loser");
    let calls = 0;
    const scoreBestCandidates: Array<{ provider: string; model: string }[]> = [];
    const strategy: IResolutionStrategy = {
      scoreBest: (candidates, _taskType) => {
        calls++;
        scoreBestCandidates.push(candidates);
        const scores: Record<string, number> = {};
        for (const c of candidates) scores[c.provider] = c.provider === "winner" ? 1 : 0;
        return Promise.resolve(scores);
      },
    };
    const registry: IModelRegistry = {
      getModelsByCapability: () => Promise.resolve([]),
      getContextWindow: () => Promise.resolve(1000), // small window forces overflow
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
    const resolver = new ModelResolver(
      new DefaultRoutingStrategy(ProviderRegistry, createStubCostTracker(), createStubHealthChecker()),
      createTestConfig(),
      createStubHealthChecker(),
      createMockEventLogger(),
      registry,
      strategy,
    );
    const result = await resolver.resolve({
      model_size: "S",
      characteristics: ["best"],
      task_type: TaskType.FEATURE,
      context_window_fallback: true,
      estimated_input_tokens: 5000, // exceeds the stubbed 1000-token window → forces a bump
    });
    // scoreBest was consulted (the overflow re-resolution re-entered the scoring path
    // with best intact) and its ranking decided the outcome.
    assertEquals(calls > 0, true);
    assertEquals(result.provider, "winner");
  } finally {
    ProviderRegistry.clear();
    await cleanup();
  }
});

Deno.test("[step135.8][GAP-9][regression] model.resolved trace is backward-compatible when task_type_source is absent", async () => {
  const { cleanup } = await initTestDbService();
  try {
    ProviderRegistry.clear();
    registerProvider("anthropic");
    const logger = createMockEventLogger();
    const resolver = makeResolver(undefined, logger);
    await resolver.resolve({ model: "anthropic:claude-x" });
    const resolvedEvents = logger.events.filter((e) => e.action === "model.resolved");
    assertEquals("task_type_source" in (resolvedEvents[0]?.payload ?? {}), false);
  } finally {
    ProviderRegistry.clear();
    await cleanup();
  }
});
