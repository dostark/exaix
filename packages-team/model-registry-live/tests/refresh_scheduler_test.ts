/**
 * @module RefreshSchedulerTest
 * @path packages-team/model-registry-live/tests/refresh_scheduler_test.ts
 * @description Phase 135 Step 5 — RegistryRefreshScheduler: opt-in construction, cron
 *   validation, per-provider atomic swap via the service, degrade-to-static on failure,
 *   one credential-scrubbed audit row per attempt, refresh/retire events, exponential
 *   back-off capped at the cron interval, DENO_TEST timer skip, and clean stop().
 * @architectural-layer Team-ModelRegistry
 */
import { assertEquals, assertThrows } from "@std/assert";
import { initTestDbService, REGISTRY_TABLES_SQL } from "@exaix/testing";
import { createMockEventLogger } from "@exaix/testing/helpers/services/barrel.ts";
import { DefaultModelRegistry } from "@exaix/model-registry";
import type { IAdapterContext, ICatalogEntry, IPricingEntry, IProviderCatalogAdapter } from "@exaix/model-registry";
import { CatalogHttpError } from "@exaix/model-registry";
import { DomainEventType } from "@exaix/core/events";
import type { Config } from "@exaix/schemas";
import { ModelRegistryService } from "../src/model_registry_service.ts";
import { AdapterRegistry } from "../src/adapters/adapter_registry.ts";
import { RegistryRefreshScheduler } from "../src/registry_refresh_scheduler.ts";
import type { IAdmissionInputs } from "../src/adapters/admission.ts";

const HEALTHY_CHECKER = { checkProvider: (_p: string) => Promise.resolve(true) };
const SECRET_KEY = "sk-secret-do-not-log";

function nativeInputs(): IAdmissionInputs {
  return {
    curatedModels: new Set<string>(),
    usedModels: new Set<string>(),
    isAggregator: false,
    keepNativeWhole: true,
    topN: 25,
  };
}

/** Adapter stub returning a fixed catalog (and optional pricing / throw). */
function stubAdapter(
  provider: string,
  catalog: ICatalogEntry[],
  opts: { pricing?: IPricingEntry[]; throwCatalog?: Error } = {},
): IProviderCatalogAdapter {
  return {
    provider,
    fetchCatalog(_ctx: IAdapterContext): Promise<ICatalogEntry[]> {
      if (opts.throwCatalog) return Promise.reject(opts.throwCatalog);
      return Promise.resolve(catalog);
    },
    fetchPricing(_ctx: IAdapterContext): Promise<IPricingEntry[]> {
      return Promise.resolve(opts.pricing ?? []);
    },
  };
}

function svcFor(
  db: Awaited<ReturnType<typeof initTestDbService>>["db"],
  config: Awaited<ReturnType<typeof initTestDbService>>["config"],
) {
  db.instance.exec(REGISTRY_TABLES_SQL);
  const floor = new DefaultModelRegistry(HEALTHY_CHECKER);
  const logger = createMockEventLogger();
  const svc = new ModelRegistryService(db, logger, config, floor, HEALTHY_CHECKER);
  return { svc, logger, floor };
}

function withRegistryConfig(base: Config, over: Partial<NonNullable<Config["model_registry"]>>): Config {
  return { ...base, model_registry: { ...(base.model_registry ?? {}), ...over } } as Config;
}

function makeScheduler(
  svc: ModelRegistryService,
  logger: ReturnType<typeof createMockEventLogger>,
  config: Config,
  adapters: IProviderCatalogAdapter[],
): RegistryRefreshScheduler {
  const registry = new AdapterRegistry();
  for (const a of adapters) registry.register(a);
  return new RegistryRefreshScheduler(svc, registry, config, logger, {
    buildContext: (_p) => ({ apiKey: SECRET_KEY, baseUrl: "https://x.test", fetch, timeoutMs: 1000 }),
    admissionInputsFor: (_p) => nativeInputs(),
  });
}

Deno.test("invalid cron rejected at start with the exported 5-field validateCronExpression (GAP-5)", async () => {
  const { db, config: base, cleanup } = await initTestDbService();
  try {
    const { svc, logger } = svcFor(db, base);
    const config = withRegistryConfig(base, { enabled: true, catalog_refresh_cron: "not a cron" });
    const scheduler = makeScheduler(svc, logger, config, [stubAdapter("anthropic", [{ model: "claude-a" }])]);
    assertThrows(() => scheduler.start(), Error, "cron");
    scheduler.stop();
  } finally {
    await cleanup();
  }
});

Deno.test("refreshOnce commits per-provider atomically and emits model.catalog.refreshed", async () => {
  const { db, config: base, cleanup } = await initTestDbService();
  try {
    const { svc, logger } = svcFor(db, base);
    const config = withRegistryConfig(base, { enabled: true });
    const scheduler = makeScheduler(svc, logger, config, [
      stubAdapter("anthropic", [{ model: "claude-a" }, { model: "claude-b" }]),
    ]);
    await scheduler.refreshOnce();
    const rows = await svc.getProviderModels("anthropic");
    assertEquals(rows.map((r) => r.model).sort(), ["claude-a", "claude-b"]);
    const refreshed = logger.events.filter((e) => e.action === DomainEventType.ModelCatalogRefreshed);
    assertEquals(refreshed.length, 1);
    assertEquals(refreshed[0].payload?.models_added, 2);
  } finally {
    await cleanup();
  }
});

Deno.test("a failed provider fetch does not roll back another provider's successful refresh (degrade-to-static)", async () => {
  const { db, config: base, cleanup } = await initTestDbService();
  try {
    const { svc, logger } = svcFor(db, base);
    const config = withRegistryConfig(base, { enabled: true });
    const scheduler = makeScheduler(svc, logger, config, [
      stubAdapter("anthropic", [{ model: "claude-a" }]),
      stubAdapter("openai", [], { throwCatalog: new CatalogHttpError("openai", 500) }),
    ]);
    await scheduler.refreshOnce();
    // anthropic succeeded; openai failed but did not wipe anthropic.
    assertEquals((await svc.getProviderModels("anthropic")).length, 1);
    const failed = logger.events.filter((e) => e.action === DomainEventType.ModelRegistryRefreshFailed);
    assertEquals(failed.length, 1);
    assertEquals(failed[0].payload?.provider, "openai");
  } finally {
    await cleanup();
  }
});

Deno.test("every attempt writes one audit row; detail never contains the API key", async () => {
  const { db, config: base, cleanup } = await initTestDbService();
  try {
    const { svc, logger } = svcFor(db, base);
    const config = withRegistryConfig(base, { enabled: true });
    const scheduler = makeScheduler(svc, logger, config, [
      stubAdapter("anthropic", [{ model: "claude-a" }]),
      stubAdapter("openai", [], { throwCatalog: new CatalogHttpError("openai", 500) }),
    ]);
    await scheduler.refreshOnce();
    const audit = db.instance.prepare("SELECT provider, kind, outcome, detail FROM registry_refresh_audit")
      .all() as Array<
        { provider: string; kind: string; outcome: string; detail: string | null }
      >;
    // One catalog audit row per provider.
    const byProvider = new Map(audit.map((a) => [a.provider, a]));
    assertEquals(byProvider.get("anthropic")?.outcome, "success");
    assertEquals(byProvider.get("openai")?.outcome, "http_error");
    for (const a of audit) {
      assertEquals((a.detail ?? "").includes(SECRET_KEY), false);
    }
  } finally {
    await cleanup();
  }
});

Deno.test("removed model emits model.retired on a subsequent refresh", async () => {
  const { db, config: base, cleanup } = await initTestDbService();
  try {
    const { svc, logger } = svcFor(db, base);
    const config = withRegistryConfig(base, { enabled: true });
    const first = makeScheduler(svc, logger, config, [stubAdapter("anthropic", [{ model: "a" }, { model: "b" }])]);
    await first.refreshOnce();
    const before = logger.events.filter((e) => e.action === DomainEventType.ModelRetired).length;
    const second = makeScheduler(svc, logger, config, [stubAdapter("anthropic", [{ model: "a" }])]);
    await second.refreshOnce();
    const retired = logger.events.filter((e) => e.action === DomainEventType.ModelRetired);
    assertEquals(retired.length - before, 1);
    assertEquals(retired[retired.length - 1].payload?.model, "b");
  } finally {
    await cleanup();
  }
});

Deno.test("pricing persisted from fetchPricing and emits model.pricing.refreshed", async () => {
  const { db, config: base, cleanup } = await initTestDbService();
  try {
    const { svc, logger } = svcFor(db, base);
    const config = withRegistryConfig(base, { enabled: true });
    const scheduler = makeScheduler(svc, logger, config, [
      stubAdapter("openrouter", [{ model: "vendor/x" }], {
        pricing: [{ model: "vendor/x", inputPerMtok: 3, outputPerMtok: 15, sourceUrl: "https://openrouter.ai" }],
      }),
    ]);
    await scheduler.refreshOnce();
    const pricing = await svc.getModelPricing("openrouter", "vendor/x");
    assertEquals(pricing.inputPerMtok, 3);
    assertEquals(pricing.provenance, "endpoint");
    const refreshed = logger.events.filter((e) => e.action === DomainEventType.ModelPricingRefreshed);
    assertEquals(refreshed.length, 1);
  } finally {
    await cleanup();
  }
});

Deno.test("repeated failures back off exponentially, capped at the cron interval", async () => {
  const { db, config: base, cleanup } = await initTestDbService();
  try {
    const { svc, logger } = svcFor(db, base);
    const config = withRegistryConfig(base, { enabled: true });
    const scheduler = makeScheduler(svc, logger, config, [
      stubAdapter("openai", [], { throwCatalog: new CatalogHttpError("openai", 500) }),
    ]);
    const cronIntervalMs = 6 * 60 * 60 * 1000;
    const d1 = scheduler.nextBackoffMs("openai", 1, cronIntervalMs);
    const d2 = scheduler.nextBackoffMs("openai", 2, cronIntervalMs);
    const d3 = scheduler.nextBackoffMs("openai", 3, cronIntervalMs);
    assertEquals(d2 > d1, true);
    assertEquals(d3 > d2, true);
    // Capped at the cron interval.
    const dHuge = scheduler.nextBackoffMs("openai", 30, cronIntervalMs);
    assertEquals(dHuge <= cronIntervalMs, true);
  } finally {
    await cleanup();
  }
});

Deno.test("[edge][cleanup] start() under DENO_TEST=1 skips the real timer; stop() leaves no handle (sanitizeOps green)", async () => {
  const { db, config: base, cleanup } = await initTestDbService();
  try {
    const { svc, logger } = svcFor(db, base);
    const config = withRegistryConfig(base, { enabled: true });
    const scheduler = makeScheduler(svc, logger, config, [stubAdapter("anthropic", [{ model: "a" }])]);
    scheduler.start(); // DENO_TEST=1 → no real setInterval scheduled
    scheduler.stop();
    // No assertion beyond sanitizeOps/Resources: a leaked timer would fail the test.
    assertEquals(scheduler.isRunning(), false);
  } finally {
    await cleanup();
  }
});

Deno.test("[edge][roundtrip] audit row outcome/models_added/models_removed/started_at survive write→read", async () => {
  const { db, config: base, cleanup } = await initTestDbService();
  try {
    const { svc, logger } = svcFor(db, base);
    const config = withRegistryConfig(base, { enabled: true });
    const startedAt = Date.now();
    const scheduler = makeScheduler(svc, logger, config, [stubAdapter("anthropic", [{ model: "a" }, { model: "b" }])]);
    await scheduler.refreshOnce();
    const row = db.instance.prepare(
      "SELECT outcome, models_added, models_removed, started_at FROM registry_refresh_audit WHERE provider = 'anthropic' AND kind = 'catalog'",
    ).get() as { outcome: string; models_added: number; models_removed: number; started_at: number };
    assertEquals(row.outcome, "success");
    assertEquals(row.models_added, 2);
    assertEquals(row.models_removed, 0);
    assertEquals(row.started_at >= startedAt, true);
  } finally {
    await cleanup();
  }
});
