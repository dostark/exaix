/**
 * @module ExplicitValidationTest
 * @path packages-team/model-registry-live/tests/adapters/explicit_validation_test.ts
 * @description Phase 135 Step 3 (G10 Team side) — the TeamResolutionStrategy
 *   validateExplicit hook: an admitted model resolves verbatim; a real-but-unadmitted
 *   model auto-admits (model.admitted{explicit_use}) and resolves; a not-real model
 *   throws "unknown model". Solo resolvers without the strategy still pass through.
 * @architectural-layer Team-ModelRegistry
 */
import { assertEquals, assertRejects } from "@std/assert";
import { initTestDbService, REGISTRY_TABLES_SQL } from "@exaix/testing";
import { createMockEventLogger } from "@exaix/testing/helpers/services/barrel.ts";
import { DefaultModelRegistry } from "@exaix/model-registry";
import type { ICatalogEntry, IProviderCatalogAdapter } from "@exaix/model-registry";
import { DomainEventType } from "@exaix/core/events";
import { ModelRegistryService } from "../../src/model_registry_service.ts";
import { TeamResolutionStrategy } from "../../src/team_resolution_strategy.ts";

const HEALTHY_CHECKER = { checkProvider: (_p: string) => Promise.resolve(true) };

/** An adapter stub that reports a fixed set of real models for its provider. */
function stubAdapter(provider: string, realModels: string[]): IProviderCatalogAdapter {
  return {
    provider,
    fetchCatalog(): Promise<ICatalogEntry[]> {
      return Promise.resolve(realModels.map((model) => ({ model, contextWindow: 128000 })));
    },
  };
}

function harness(
  db: Awaited<ReturnType<typeof initTestDbService>>["db"],
  config: Awaited<ReturnType<typeof initTestDbService>>["config"],
  adapters: IProviderCatalogAdapter[],
) {
  db.instance.exec(REGISTRY_TABLES_SQL);
  const floor = new DefaultModelRegistry(HEALTHY_CHECKER);
  const logger = createMockEventLogger();
  const svc = new ModelRegistryService(db, logger, config, floor, HEALTHY_CHECKER);
  const strategy = new TeamResolutionStrategy(svc, logger, {
    getAdapter: (p) => adapters.find((a) => a.provider === p),
    buildContext: () => ({ baseUrl: "https://x.test", fetch, timeoutMs: 1000 }),
    isAggregator: (p) => p === "openrouter",
    costExempt: () => false,
    providerCostMetadata: () => undefined,
    routeHealth: () => ({}),
    routePolicy: "cheapest",
    routePriceTolerance: 0.05,
    routeOrder: {},
  });
  return { svc, logger, strategy };
}

Deno.test("explicit admitted model resolves verbatim", async () => {
  const { db, config, cleanup } = await initTestDbService();
  try {
    const { svc, strategy } = harness(db, config, [stubAdapter("openrouter", ["vendor/x"])]);
    await svc.applyRefresh("openrouter", [{ model: "vendor/x" }], {
      curatedModels: new Set(["vendor/x"]),
      usedModels: new Set(),
      isAggregator: true,
      keepNativeWhole: true,
      topN: 25,
      benchmarkTopN: new Set(),
    });
    const route = await strategy.validateExplicit("openrouter", "vendor/x");
    assertEquals(route, { provider: "openrouter", model: "vendor/x" });
  } finally {
    await cleanup();
  }
});

Deno.test("explicit unadmitted-but-real model auto-admits, resolves, and emits model.admitted{explicit_use}", async () => {
  const { db, config, cleanup } = await initTestDbService();
  try {
    const { svc, logger, strategy } = harness(db, config, [stubAdapter("openrouter", ["vendor/rare"])]);
    // Not admitted yet: empty catalog for openrouter.
    const route = await strategy.validateExplicit("openrouter", "vendor/rare");
    assertEquals(route, { provider: "openrouter", model: "vendor/rare" });
    // Now stored.
    const rows = await svc.getProviderModels("openrouter");
    assertEquals(rows.map((r) => r.model), ["vendor/rare"]);
    const admitted = logger.events.filter((e) => e.action === DomainEventType.ModelAdmitted);
    assertEquals(
      admitted.some((e) => e.payload?.model === "vendor/rare" && e.payload?.reason === "explicit_use"),
      true,
    );
  } finally {
    await cleanup();
  }
});

Deno.test("explicit not-real model errors unknown model (Team semantics)", async () => {
  const { db, config, cleanup } = await initTestDbService();
  try {
    const { strategy } = harness(db, config, [stubAdapter("openrouter", ["vendor/real-only"])]);
    await assertRejects(
      () => strategy.validateExplicit("openrouter", "vendor/ghost"),
      Error,
      "unknown model",
    );
  } finally {
    await cleanup();
  }
});

Deno.test("[edge][integration] auto-admitting an unadmitted-but-real model does not evict admitted curated/native rows", async () => {
  const { db, config, cleanup } = await initTestDbService();
  try {
    const { svc, strategy } = harness(db, config, [stubAdapter("openrouter", ["vendor/rare"])]);
    await svc.applyRefresh("openrouter", [{ model: "vendor/curated" }], {
      curatedModels: new Set(["vendor/curated"]),
      usedModels: new Set(),
      isAggregator: true,
      keepNativeWhole: true,
      topN: 25,
      benchmarkTopN: new Set(),
    });
    await strategy.validateExplicit("openrouter", "vendor/rare");
    const rows = await svc.getProviderModels("openrouter");
    assertEquals(rows.map((r) => r.model).sort(), ["vendor/curated", "vendor/rare"]);
  } finally {
    await cleanup();
  }
});

Deno.test("[step4] native-provider auto-admit reads isAggregator=false and keeps native rows whole", async () => {
  const { db, config, cleanup } = await initTestDbService();
  try {
    const { svc, strategy } = harness(db, config, [stubAdapter("anthropic", ["claude-new"])]);
    // Seed an existing native row, then auto-admit a second real native model.
    await svc.applyRefresh("anthropic", [{ model: "claude-existing" }], {
      curatedModels: new Set(),
      usedModels: new Set(),
      isAggregator: false,
      keepNativeWhole: true,
      topN: 25,
      benchmarkTopN: new Set(),
    });
    const route = await strategy.validateExplicit("anthropic", "claude-new");
    assertEquals(route, { provider: "anthropic", model: "claude-new" });
    const rows = await svc.getProviderModels("anthropic");
    assertEquals(rows.map((r) => r.model).sort(), ["claude-existing", "claude-new"]);
  } finally {
    await cleanup();
  }
});
