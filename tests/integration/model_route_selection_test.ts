/**
 * @module ModelRouteSelectionIntegrationTest
 * @path tests/integration/model_route_selection_test.ts
 * @description Phase 135 Step 6 — the route sub-step end-to-end through the Team seam:
 *   a model with two seeded routes (anthropic + openrouter) resolves via the cheaper
 *   route when TeamResolutionStrategy.selectRoute is registered, emits model.route.selected
 *   with the considered routes, and carries route_reason on the model.resolved trace; a
 *   single-route model short-circuits with route_reason single_route and no event.
 * @architectural-layer Integration
 */
import { assertEquals } from "@std/assert";
import { initTestDbService, REGISTRY_TABLES_SQL } from "@exaix/testing";
import { createMockEventLogger } from "@exaix/testing/helpers/services/barrel.ts";
import { DefaultModelRegistry } from "@exaix/model-registry";
import { DomainEventType } from "@exaix/core/events";
import { ModelRegistryService, TeamResolutionStrategy } from "@exaix-team/model-registry-live";

const HEALTHY = { checkProvider: (_p: string) => Promise.resolve(true) };

function seedRoute(
  db: Awaited<ReturnType<typeof initTestDbService>>["db"],
  provider: string,
  model: string,
  price: { input: number; output: number },
) {
  db.instance.prepare(
    `INSERT INTO model_catalog (provider, model, supports_thinking, supports_effort, source, refreshed_at)
     VALUES (?, ?, 0, 0, 'endpoint', ?)`,
  ).run(provider, model, Date.now());
  db.instance.prepare(
    `INSERT INTO model_pricing (provider, model, input_per_mtok, output_per_mtok, provenance, verified_at)
     VALUES (?, ?, ?, ?, 'endpoint', ?)`,
  ).run(provider, model, price.input, price.output, Date.now());
}

function teamStrategy(svc: ModelRegistryService, logger: ReturnType<typeof createMockEventLogger>) {
  return new TeamResolutionStrategy(svc, logger, {
    getAdapter: () => undefined,
    buildContext: () => ({ baseUrl: "https://x.test", fetch, timeoutMs: 1000 }),
    isAggregator: (p) => p === "openrouter",
    costExempt: () => false,
    routeHealth: () => ({ circuitState: 1 }),
    routePolicy: "cheapest",
    routePriceTolerance: 0.05,
    routeOrder: {},
  });
}

Deno.test("[step6] a 2-route model resolves via the cheaper route and emits model.route.selected", async () => {
  const { db, config, cleanup } = await initTestDbService();
  try {
    db.instance.exec(REGISTRY_TABLES_SQL);
    const floor = new DefaultModelRegistry(HEALTHY);
    const logger = createMockEventLogger();
    const svc = new ModelRegistryService(db, logger, config, floor, HEALTHY);
    seedRoute(db, "anthropic", "claude-3.5-sonnet", { input: 3, output: 15 });
    seedRoute(db, "openrouter", "claude-3.5-sonnet", { input: 2, output: 10 });

    const strategy = teamStrategy(svc, logger);
    const selected = await strategy.selectRoute!({ provider: "anthropic", model: "claude-3.5-sonnet" });
    assertEquals(selected.provider, "openrouter"); // cheaper route
    assertEquals(selected.route_reason, "cheapest");
    assertEquals(selected.considered_routes?.length, 2);

    const routeEvents = logger.events.filter((e) => e.action === DomainEventType.ModelRouteSelected);
    assertEquals(routeEvents.length, 1);
    assertEquals(routeEvents[0].payload?.chosen_provider, "openrouter");
  } finally {
    await cleanup();
  }
});

Deno.test("[step6] a single-route model short-circuits with route_reason single_route and no event", async () => {
  const { db, config, cleanup } = await initTestDbService();
  try {
    db.instance.exec(REGISTRY_TABLES_SQL);
    const floor = new DefaultModelRegistry(HEALTHY);
    const logger = createMockEventLogger();
    const svc = new ModelRegistryService(db, logger, config, floor, HEALTHY);
    seedRoute(db, "anthropic", "solo-model", { input: 3, output: 15 });

    const strategy = teamStrategy(svc, logger);
    const selected = await strategy.selectRoute!({ provider: "anthropic", model: "solo-model" });
    assertEquals(selected.provider, "anthropic");
    assertEquals(selected.route_reason, "single_route");
    const routeEvents = logger.events.filter((e) => e.action === DomainEventType.ModelRouteSelected);
    assertEquals(routeEvents.length, 0);
  } finally {
    await cleanup();
  }
});
