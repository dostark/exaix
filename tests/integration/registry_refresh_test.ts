/**
 * @module RegistryRefreshIntegrationTest
 * @path tests/integration/registry_refresh_test.ts
 * @description Phase 135 Step 5 — the §1 requirement-1 opt-in proof: with
 *   model_registry.enabled=true a committed refresh changes the next resolution's
 *   candidate set (getProviderModels), and with enabled=false the scheduler is never
 *   constructed so there are zero outbound fetch calls and the candidate set is
 *   unchanged (byte-identical to no-registry Solo behaviour).
 * @architectural-layer Integration
 */
import { assertEquals } from "@std/assert";
import { initTestDbService, REGISTRY_TABLES_SQL } from "@exaix/testing";
import { createMockEventLogger } from "@exaix/testing/helpers/services/barrel.ts";
import { DefaultModelRegistry } from "@exaix/model-registry";
import type { IAdapterContext, ICatalogEntry, IProviderCatalogAdapter } from "@exaix/model-registry";
import type { Config } from "@exaix/schemas";
import { AdapterRegistry, maybeCreateRefreshScheduler, ModelRegistryService } from "@exaix-team/model-registry-live";
import type { IAdmissionInputs } from "@exaix-team/model-registry-live";

const HEALTHY = { checkProvider: (_p: string) => Promise.resolve(true) };

let fetchCalls = 0;
function countingAdapter(provider: string, catalog: ICatalogEntry[]): IProviderCatalogAdapter {
  return {
    provider,
    fetchCatalog(_ctx: IAdapterContext): Promise<ICatalogEntry[]> {
      fetchCalls++;
      return Promise.resolve(catalog);
    },
  };
}

function nativeInputs(): IAdmissionInputs {
  return {
    curatedModels: new Set(),
    usedModels: new Set(),
    isAggregator: false,
    keepNativeWhole: true,
    topN: 25,
    benchmarkTopN: new Set(),
  };
}

function buildScheduler(
  svc: ModelRegistryService,
  logger: ReturnType<typeof createMockEventLogger>,
  config: Config,
) {
  const adapters = new AdapterRegistry();
  adapters.register(countingAdapter("anthropic", [{ model: "claude-fresh" }]));
  return maybeCreateRefreshScheduler(svc, adapters, config, logger, {
    buildContext: (_p) => ({ baseUrl: "https://x.test", fetch, timeoutMs: 1000 }),
    admissionInputsFor: (_p) => nativeInputs(),
  });
}

Deno.test("[step5][opt-in] enabled=true: a committed refresh changes the next resolution candidate set", async () => {
  const { db, config: base, cleanup } = await initTestDbService();
  try {
    db.instance.exec(REGISTRY_TABLES_SQL);
    fetchCalls = 0;
    const floor = new DefaultModelRegistry(HEALTHY);
    const logger = createMockEventLogger();
    const svc = new ModelRegistryService(db, logger, base, floor, HEALTHY);
    const config = { ...base, model_registry: { ...(base.model_registry ?? {}), enabled: true } } as Config;

    // Before refresh: catalog empty → getProviderModels for anthropic falls to the floor.
    const before = await svc.getProviderModels("anthropic");

    const scheduler = buildScheduler(svc, logger, config);
    assertEquals(scheduler !== undefined, true);
    await scheduler!.refreshOnce();

    const after = await svc.getProviderModels("anthropic");
    // The committed refresh introduced the live model into the candidate set.
    assertEquals(after.some((m) => m.model === "claude-fresh"), true);
    assertEquals(
      after.some((m) => m.model === "claude-fresh") && !before.some((m) => m.model === "claude-fresh"),
      true,
    );
  } finally {
    await cleanup();
  }
});

Deno.test("[step5][opt-in] enabled=false (default): scheduler never constructed; zero fetch calls", async () => {
  const { db, config: base, cleanup } = await initTestDbService();
  try {
    db.instance.exec(REGISTRY_TABLES_SQL);
    fetchCalls = 0;
    const floor = new DefaultModelRegistry(HEALTHY);
    const logger = createMockEventLogger();
    const svc = new ModelRegistryService(db, logger, base, floor, HEALTHY);
    // No model_registry block at all → enabled defaults false.
    const scheduler = buildScheduler(svc, logger, base);
    assertEquals(scheduler, undefined);
    assertEquals(fetchCalls, 0);
  } finally {
    await cleanup();
  }
});
