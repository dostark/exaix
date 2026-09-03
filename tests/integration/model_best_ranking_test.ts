/**
 * @module ModelBestRankingIntegrationTest
 * @path tests/integration/model_best_ranking_test.ts
 * @description Phase 135 Step 8 — the `best` characteristic end-to-end through the Team
 *   seam: a feature-task ["best"] request resolves to the top SWE-bench-scored candidate
 *   via ModelResolver → TeamResolutionStrategy.scoreBest → ModelRegistryService's
 *   persisted model_benchmark scores, with reason best_ranked and task_type_source
 *   traced on model.resolved.
 * @architectural-layer Integration
 */
import { assertEquals } from "@std/assert";
import { initTestDbService, REGISTRY_TABLES_SQL } from "@exaix/testing";
import { createMockEventLogger } from "@exaix/testing/helpers/services/barrel.ts";
import { DefaultModelRegistry } from "@exaix/model-registry";
import { ModelRegistryService, TeamResolutionStrategy } from "@exaix-team/model-registry-live";
import { ModelResolver, ProviderRegistry } from "@exaix/ai";
import { DefaultRoutingStrategy } from "@exaix/ai/routing/default_routing_strategy.ts";
import { MockProviderFactory } from "@exaix/ai/factories/mock_factory.ts";
import { PricingTier, ProviderCostTier, TaskType } from "@exaix/core";
import { createTestConfig } from "../../packages/ai/tests/helpers/test_config.ts";
import { createStubCostTracker, createStubHealthChecker } from "../../packages/ai/tests/helpers/service_stubs.ts";

const HEALTHY = { checkProvider: (_p: string) => Promise.resolve(true) };

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

Deno.test('[step135.8][integration] a feature-task ["best"] request resolves to the top SWE-bench candidate with reason best_ranked and task_type_source traced', async () => {
  const { db, config, cleanup } = await initTestDbService();
  try {
    db.instance.exec(REGISTRY_TABLES_SQL);
    ProviderRegistry.clear();
    registerProvider("anthropic");
    registerProvider("openai");

    const floor = new DefaultModelRegistry(HEALTHY);
    const logger = createMockEventLogger();
    const svc = new ModelRegistryService(db, logger, config, floor, HEALTHY);
    // anthropic scores higher than openai on swe_bench_verified — the resolved provider
    // must be the one scoreBest ranks first, not whichever the default selector prefers.
    await svc.applyBenchmarks([
      {
        provider: "anthropic",
        model: "anthropic",
        benchmark: "swe_bench_verified",
        score: 0.9,
        provenance: "static",
        measuredAt: 1,
      },
      {
        provider: "openai",
        model: "openai",
        benchmark: "swe_bench_verified",
        score: 0.3,
        provenance: "static",
        measuredAt: 1,
      },
    ]);

    const strategy = new TeamResolutionStrategy(svc, logger, {
      getAdapter: () => undefined,
      buildContext: () => ({ baseUrl: "https://x.test", fetch, timeoutMs: 1000 }),
      isAggregator: () => false,
      costExempt: () => false,
      providerCostMetadata: () => undefined,
      routeHealth: () => ({ circuitState: 1 }),
      routePolicy: "cheapest",
      routePriceTolerance: 0.05,
      routeOrder: {},
      benchmarkMap: { [TaskType.FEATURE]: ["swe_bench_verified"] },
      usageTiebreak: false,
    });

    const resolver = new ModelResolver(
      new DefaultRoutingStrategy(ProviderRegistry, createStubCostTracker(), createStubHealthChecker()),
      createTestConfig(),
      createStubHealthChecker(),
      logger,
      undefined,
      strategy,
    );

    const result = await resolver.resolve({
      characteristics: ["best"],
      task_type: TaskType.FEATURE,
      task_type_source: "agent_role",
    });

    assertEquals(result.provider, "anthropic");

    const resolvedEvents = logger.events.filter((e) => e.action === "model.resolved");
    assertEquals(resolvedEvents[0]?.payload?.reason, "best_ranked");
    assertEquals(resolvedEvents[0]?.payload?.task_type_source, "agent_role");
  } finally {
    ProviderRegistry.clear();
    await cleanup();
  }
});
