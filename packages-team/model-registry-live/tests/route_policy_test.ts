/**
 * @module RoutePolicyTest
 * @path packages-team/model-registry-live/tests/route_policy_test.ts
 * @description Phase 135 Step 6 (F9 + G4) — the multi-route selection policies:
 *   routesFor(model), the composite route_health_score with renormalisation, and the
 *   four policies (cheapest / reliability / native_first / user_order) plus the pinned
 *   and single-route short-circuits.
 * @architectural-layer Team-ModelRegistry
 */
import { assertAlmostEquals, assertEquals } from "@std/assert";
import { initTestDbService, REGISTRY_TABLES_SQL } from "@exaix/testing";
import { createMockEventLogger } from "@exaix/testing/helpers/services/barrel.ts";
import { DefaultModelRegistry } from "@exaix/model-registry";
import { ROUTE_HEALTH_WEIGHT_CIRCUIT, ROUTE_HEALTH_WEIGHT_FAILURE_COUNT } from "@exaix/core/types";
import { ModelRegistryService } from "../src/model_registry_service.ts";
import { routeHealthScore, RoutePolicy } from "../src/route_policy.ts";
import type { IRouteHealthProvider, IRouteHealthSignals } from "../src/route_policy.ts";

const HEALTHY = { checkProvider: (_p: string) => Promise.resolve(true) };

function svcFor(
  db: Awaited<ReturnType<typeof initTestDbService>>["db"],
  config: Awaited<ReturnType<typeof initTestDbService>>["config"],
) {
  db.instance.exec(REGISTRY_TABLES_SQL);
  const floor = new DefaultModelRegistry(HEALTHY);
  const svc = new ModelRegistryService(db, createMockEventLogger(), config, floor, HEALTHY);
  return svc;
}

/** Seed a (provider, model) catalog row + optional per-Mtok pricing. */
function seedRoute(
  db: Awaited<ReturnType<typeof initTestDbService>>["db"],
  provider: string,
  model: string,
  price?: { input: number; output: number; provenance?: string },
) {
  db.instance.prepare(
    `INSERT INTO model_catalog (provider, model, supports_thinking, supports_effort, source, refreshed_at)
     VALUES (?, ?, 0, 0, 'endpoint', ?)`,
  ).run(provider, model, Date.now());
  if (price) {
    db.instance.prepare(
      `INSERT INTO model_pricing (provider, model, input_per_mtok, output_per_mtok, provenance, verified_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(provider, model, price.input, price.output, price.provenance ?? "endpoint", Date.now());
  }
}

function healthProvider(map: Record<string, IRouteHealthSignals>): IRouteHealthProvider {
  return { routeHealth: (provider) => map[provider] ?? {} };
}

function makePolicy(
  svc: ModelRegistryService,
  health: IRouteHealthProvider,
  costExemptProviders: string[] = [],
) {
  return new RoutePolicy(svc, health, {
    isAggregator: (p) => p === "openrouter",
    costExempt: (p) => costExemptProviders.includes(p),
    providerCostMetadata: () => undefined,
  });
}

Deno.test("routesFor returns all (provider, model) rows for a model identity", async () => {
  const { db, config, cleanup } = await initTestDbService();
  try {
    const svc = svcFor(db, config);
    seedRoute(db, "anthropic", "claude-3.5-sonnet");
    seedRoute(db, "openrouter", "claude-3.5-sonnet");
    seedRoute(db, "openai", "gpt-4o");
    const policy = makePolicy(svc, healthProvider({}));
    const routes = await policy.routesFor("claude-3.5-sonnet");
    assertEquals(routes.map((r) => r.provider).sort(), ["anthropic", "openrouter"]);
  } finally {
    await cleanup();
  }
});

Deno.test("[edge][malformed] routesFor on a model with zero catalog rows returns [] and does not throw", async () => {
  const { db, config, cleanup } = await initTestDbService();
  try {
    const svc = svcFor(db, config);
    const policy = makePolicy(svc, healthProvider({}));
    assertEquals(await policy.routesFor("nonexistent"), []);
  } finally {
    await cleanup();
  }
});

Deno.test("route_health_score composes circuit + failure-headroom; a missing sub-signal renormalises the weights to sum 1 (GAP-7)", () => {
  // Both signals present: weighted average.
  const both = routeHealthScore({ circuitState: 1, failureHeadroom: 0 });
  const expectedBoth = (ROUTE_HEALTH_WEIGHT_CIRCUIT * 1 + ROUTE_HEALTH_WEIGHT_FAILURE_COUNT * 0) /
    (ROUTE_HEALTH_WEIGHT_CIRCUIT + ROUTE_HEALTH_WEIGHT_FAILURE_COUNT);
  assertAlmostEquals(both, expectedBoth);
  // Only circuit present: renormalises to the circuit signal alone (weight cancels).
  assertAlmostEquals(routeHealthScore({ circuitState: 0.5 }), 0.5);
  // Only failure-headroom present.
  assertAlmostEquals(routeHealthScore({ failureHeadroom: 0.75 }), 0.75);
  // No signals: neutral 1 (nothing known against the route).
  assertAlmostEquals(routeHealthScore({}), 1);
});

Deno.test("cheapest picks the lowest per-Mtok route; ties within tolerance broken by health score", async () => {
  const { db, config, cleanup } = await initTestDbService();
  try {
    const svc = svcFor(db, config);
    seedRoute(db, "anthropic", "m", { input: 3, output: 15 });
    seedRoute(db, "openrouter", "m", { input: 2, output: 10 });
    const policy = makePolicy(svc, healthProvider({}));
    const sel = await policy.select("m", "cheapest", { priceTolerance: 0.05, routeOrder: {} });
    assertEquals(sel.route.provider, "openrouter");
    assertEquals(sel.reason, "cheapest");
    assertEquals(sel.considered.length, 2);
  } finally {
    await cleanup();
  }
});

Deno.test("cheapest ties within tolerance broken by health score", async () => {
  const { db, config, cleanup } = await initTestDbService();
  try {
    const svc = svcFor(db, config);
    // Near-identical prices (within 5% tolerance) → health tiebreak.
    seedRoute(db, "anthropic", "m", { input: 3.0, output: 15 });
    seedRoute(db, "openrouter", "m", { input: 3.05, output: 15 });
    const policy = makePolicy(
      svc,
      healthProvider({ anthropic: { circuitState: 0 }, openrouter: { circuitState: 1 } }),
    );
    const sel = await policy.select("m", "cheapest", { priceTolerance: 0.05, routeOrder: {} });
    assertEquals(sel.route.provider, "openrouter"); // healthier wins the near-tie
  } finally {
    await cleanup();
  }
});

Deno.test("D7-exempt local route wins cheapest at $0 without a pricing lookup (spy)", async () => {
  const { db, config, cleanup } = await initTestDbService();
  try {
    const svc = svcFor(db, config);
    seedRoute(db, "openrouter", "m", { input: 2, output: 10 });
    seedRoute(db, "ollama", "m"); // exemption is metadata-driven (no pricing row needed)
    const lookedUp: string[] = [];
    const spySvc = new Proxy(svc, {
      get(target, prop, receiver) {
        if (prop === "getModelPricing") {
          return (provider: string, model: string) => {
            lookedUp.push(provider);
            return target.getModelPricing(provider, model);
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    }) as ModelRegistryService;
    // ollama is cost-exempt by metadata (LOCAL tier) via the deps seam.
    const policy = makePolicy(spySvc, healthProvider({}), ["ollama"]);
    const sel = await policy.select("m", "cheapest", { priceTolerance: 0.05, routeOrder: {} });
    assertEquals(sel.route.provider, "ollama");
    // The exempt route was NOT priced (only the non-exempt openrouter route was looked up).
    assertEquals(lookedUp.includes("ollama"), false);
  } finally {
    await cleanup();
  }
});

Deno.test("unknown-priced route loses to any priced route under cheapest (F1)", async () => {
  const { db, config, cleanup } = await initTestDbService();
  try {
    const svc = svcFor(db, config);
    seedRoute(db, "anthropic", "m", { input: 3, output: 15 }); // priced
    seedRoute(db, "openrouter", "m"); // no pricing row → unknown
    const policy = makePolicy(svc, healthProvider({}));
    const sel = await policy.select("m", "cheapest", { priceTolerance: 0.05, routeOrder: {} });
    assertEquals(sel.route.provider, "anthropic"); // unknown loses to priced
  } finally {
    await cleanup();
  }
});

Deno.test("reliability picks the highest composite score; missing sub-signals renormalise", async () => {
  const { db, config, cleanup } = await initTestDbService();
  try {
    const svc = svcFor(db, config);
    seedRoute(db, "anthropic", "m", { input: 1, output: 1 });
    seedRoute(db, "openrouter", "m", { input: 1, output: 1 });
    const policy = makePolicy(
      svc,
      healthProvider({ anthropic: { circuitState: 0.5 }, openrouter: { circuitState: 1 } }),
    );
    const sel = await policy.select("m", "reliability", { priceTolerance: 0.05, routeOrder: {} });
    assertEquals(sel.route.provider, "openrouter");
    assertEquals(sel.reason, "reliability");
  } finally {
    await cleanup();
  }
});

Deno.test("native_first prefers isAggregator!==true; unhealthy native falls to healthiest aggregator", async () => {
  const { db, config, cleanup } = await initTestDbService();
  try {
    const svc = svcFor(db, config);
    // Healthy native wins outright.
    seedRoute(db, "anthropic", "m", { input: 3, output: 15 });
    seedRoute(db, "openrouter", "m", { input: 2, output: 10 });
    const healthyNative = makePolicy(
      svc,
      healthProvider({ anthropic: { circuitState: 1 }, openrouter: { circuitState: 1 } }),
    );
    const sel1 = await healthyNative.select("m", "native_first", { priceTolerance: 0.05, routeOrder: {} });
    assertEquals(sel1.route.provider, "anthropic");
    assertEquals(sel1.reason, "native_first");

    // Unhealthy native (circuit OPEN) → falls to the healthiest aggregator.
    const unhealthyNative = makePolicy(
      svc,
      healthProvider({ anthropic: { circuitState: 0 }, openrouter: { circuitState: 1 } }),
    );
    const sel2 = await unhealthyNative.select("m", "native_first", { priceTolerance: 0.05, routeOrder: {} });
    assertEquals(sel2.route.provider, "openrouter");
  } finally {
    await cleanup();
  }
});

Deno.test("user_order walks route_order[model]; missing entry falls to cheapest (G4)", async () => {
  const { db, config, cleanup } = await initTestDbService();
  try {
    const svc = svcFor(db, config);
    seedRoute(db, "anthropic", "m", { input: 3, output: 15 });
    seedRoute(db, "openrouter", "m", { input: 2, output: 10 });
    const policy = makePolicy(svc, healthProvider({}));
    // route_order pins anthropic first.
    const sel = await policy.select("m", "user_order", {
      priceTolerance: 0.05,
      routeOrder: { m: ["anthropic", "openrouter"] },
    });
    assertEquals(sel.route.provider, "anthropic");
    assertEquals(sel.reason, "user_order");

    // No route_order entry → falls to cheapest.
    const fallback = await policy.select("m", "user_order", { priceTolerance: 0.05, routeOrder: {} });
    assertEquals(fallback.route.provider, "openrouter"); // cheapest
    assertEquals(fallback.reason, "cheapest");
  } finally {
    await cleanup();
  }
});

Deno.test("[edge][malformed] user_order listing a provider absent from the catalog skips it and falls to the next", async () => {
  const { db, config, cleanup } = await initTestDbService();
  try {
    const svc = svcFor(db, config);
    seedRoute(db, "openrouter", "m", { input: 2, output: 10 });
    const policy = makePolicy(svc, healthProvider({}));
    const sel = await policy.select("m", "user_order", {
      priceTolerance: 0.05,
      routeOrder: { m: ["not-in-catalog", "openrouter"] },
    });
    assertEquals(sel.route.provider, "openrouter"); // skips absent, takes next
  } finally {
    await cleanup();
  }
});

Deno.test("[edge][idempotency] the same seeded routes + policy pick the same route on repeated selects", async () => {
  const { db, config, cleanup } = await initTestDbService();
  try {
    const svc = svcFor(db, config);
    seedRoute(db, "anthropic", "m", { input: 3, output: 15 });
    seedRoute(db, "openrouter", "m", { input: 2, output: 10 });
    const policy = makePolicy(svc, healthProvider({}));
    const a = await policy.select("m", "cheapest", { priceTolerance: 0.05, routeOrder: {} });
    const b = await policy.select("m", "cheapest", { priceTolerance: 0.05, routeOrder: {} });
    assertEquals(a.route.provider, b.route.provider);
  } finally {
    await cleanup();
  }
});
