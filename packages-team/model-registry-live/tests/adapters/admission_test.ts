/**
 * @module AdmissionTest
 * @path packages-team/model-registry-live/tests/adapters/admission_test.ts
 * @description Phase 135 Step 3 (F12) — ModelRegistryService.applyRefresh admits
 *   curated ∪ native ∪ previously-used models, bounds a 400-entry aggregator fetch to
 *   the admitted tens, emits model.admitted per row, is all-or-nothing per provider,
 *   and is idempotent.
 * @architectural-layer Team-ModelRegistry
 */
import { assertEquals } from "@std/assert";
import { initTestDbService, REGISTRY_TABLES_SQL } from "@exaix/testing";
import { createMockEventLogger } from "@exaix/testing/helpers/services/barrel.ts";
import { DefaultModelRegistry } from "@exaix/model-registry";
import type { ICatalogEntry } from "@exaix/model-registry";
import { DomainEventType } from "@exaix/core/events";
import { ModelRegistryService } from "../../src/model_registry_service.ts";
import type { IAdmissionInputs } from "../../src/adapters/admission.ts";

const HEALTHY_CHECKER = { checkProvider: (_p: string) => Promise.resolve(true) };

function entry(model: string): ICatalogEntry {
  return { model, contextWindow: 128000, maxOutputTokens: 8192 };
}

function nativeInputs(overrides: Partial<IAdmissionInputs> = {}): IAdmissionInputs {
  return {
    curatedModels: new Set<string>(),
    usedModels: new Set<string>(),
    isAggregator: false,
    keepNativeWhole: true,
    topN: 25,
    benchmarkTopN: new Set(),
    ...overrides,
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
  return { svc, logger };
}

function eventsByAction(logger: ReturnType<typeof createMockEventLogger>, action: string) {
  return logger.events.filter((e) => e.action === action);
}

Deno.test("admission: native provider persists whole (keep_native_whole)", async () => {
  const { db, config, cleanup } = await initTestDbService();
  try {
    const { svc } = svcFor(db, config);
    await svc.applyRefresh("anthropic", [entry("claude-a"), entry("claude-b")], nativeInputs());
    const rows = await svc.getProviderModels("anthropic");
    assertEquals(rows.map((r) => r.model).sort(), ["claude-a", "claude-b"]);
  } finally {
    await cleanup();
  }
});

Deno.test("admission: aggregator keeps only curated ∪ used; 400-entry fetch stores tens (F12 bound)", async () => {
  const { db, config, cleanup } = await initTestDbService();
  try {
    const { svc } = svcFor(db, config);
    const big: ICatalogEntry[] = [];
    for (let i = 0; i < 400; i++) big.push(entry(`vendor/model-${i}`));
    await svc.applyRefresh(
      "openrouter",
      big,
      nativeInputs({
        isAggregator: true,
        curatedModels: new Set(["vendor/model-1", "vendor/model-2"]),
        usedModels: new Set(["vendor/model-3"]),
      }),
    );
    const rows = await svc.getProviderModels("openrouter");
    assertEquals(rows.map((r) => r.model).sort(), ["vendor/model-1", "vendor/model-2", "vendor/model-3"]);
  } finally {
    await cleanup();
  }
});

Deno.test("admission emits model.admitted with reason curated/native/explicit_use", async () => {
  const { db, config, cleanup } = await initTestDbService();
  try {
    const { svc, logger } = svcFor(db, config);
    await svc.applyRefresh(
      "openrouter",
      [entry("vendor/curated"), entry("vendor/used"), entry("vendor/ignored")],
      nativeInputs({
        isAggregator: true,
        curatedModels: new Set(["vendor/curated"]),
        usedModels: new Set(["vendor/used"]),
      }),
    );
    const admitted = eventsByAction(logger, DomainEventType.ModelAdmitted);
    const byModel = new Map(admitted.map((e) => [e.payload?.model, e.payload?.reason]));
    assertEquals(byModel.get("vendor/curated"), "curated");
    assertEquals(byModel.get("vendor/used"), "explicit_use");
    assertEquals(byModel.has("vendor/ignored"), false);
  } finally {
    await cleanup();
  }
});

Deno.test("admission: native rows emit model.admitted reason native", async () => {
  const { db, config, cleanup } = await initTestDbService();
  try {
    const { svc, logger } = svcFor(db, config);
    await svc.applyRefresh("anthropic", [entry("claude-x")], nativeInputs());
    const admitted = eventsByAction(logger, DomainEventType.ModelAdmitted);
    assertEquals(admitted[0].payload?.reason, "native");
  } finally {
    await cleanup();
  }
});

Deno.test("removed model emits model.retired {provider, model}", async () => {
  const { db, config, cleanup } = await initTestDbService();
  try {
    const { svc, logger } = svcFor(db, config);
    await svc.applyRefresh("anthropic", [entry("claude-a"), entry("claude-b")], nativeInputs());
    const before = eventsByAction(logger, DomainEventType.ModelRetired).length;
    await svc.applyRefresh("anthropic", [entry("claude-a")], nativeInputs());
    const retired = eventsByAction(logger, DomainEventType.ModelRetired);
    assertEquals(retired.length - before, 1);
    assertEquals(retired[retired.length - 1].payload?.model, "claude-b");
  } finally {
    await cleanup();
  }
});

Deno.test("[edge][idempotency] applyRefresh with the same entries twice yields the same admitted rows", async () => {
  const { db, config, cleanup } = await initTestDbService();
  try {
    const { svc } = svcFor(db, config);
    const entries = [entry("claude-a"), entry("claude-b")];
    await svc.applyRefresh("anthropic", entries, nativeInputs());
    await svc.applyRefresh("anthropic", entries, nativeInputs());
    const rows = await svc.getProviderModels("anthropic");
    assertEquals(rows.map((r) => r.model).sort(), ["claude-a", "claude-b"]);
  } finally {
    await cleanup();
  }
});

Deno.test("[edge][partial-failure] a batch that fails mid-write leaves the previous catalog intact (all-or-nothing)", async () => {
  const { db, config, cleanup } = await initTestDbService();
  try {
    const { svc } = svcFor(db, config);
    await svc.applyRefresh("anthropic", [entry("claude-good")], nativeInputs());
    // A malformed entry (empty model id) forces the per-provider transaction to roll back.
    const poisoned: ICatalogEntry[] = [entry("claude-new"), { model: "" }];
    let threw = false;
    try {
      await svc.applyRefresh("anthropic", poisoned, nativeInputs());
    } catch {
      threw = true;
    }
    assertEquals(threw, true);
    const rows = await svc.getProviderModels("anthropic");
    assertEquals(rows.map((r) => r.model), ["claude-good"]);
  } finally {
    await cleanup();
  }
});
