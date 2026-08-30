/**
 * @module ModelRegistryServiceTest
 * @path packages-team/model-registry-live/tests/model_registry_service_test.ts
 * @description Phase 135 Step 1 — unit tests for the Team live ModelRegistryService:
 *   floor fallback on empty tables (Solo equivalence), catalog/pricing reads,
 *   provenance + stale-price event, latency/rate-limit persistence, health delegation.
 * @architectural-layer Team-ModelRegistry
 */
import { assertEquals, assertExists } from "@std/assert";
import { initTestDbService, REGISTRY_TABLES_SQL } from "@exaix/testing";
import { createMockEventLogger } from "@exaix/testing/helpers/services/barrel.ts";
import { DefaultModelRegistry } from "@exaix/model-registry";
import { HealthStatus } from "@exaix/core/types";
import { DomainEventType } from "@exaix/core/events";
import { ModelRegistryService } from "../src/model_registry_service.ts";

const HEALTHY_CHECKER = { checkProvider: (_p: string) => Promise.resolve(true) };

Deno.test("empty catalog: reads fall through to the floor (Solo equivalence)", async () => {
  const { db, config, cleanup } = await initTestDbService();
  try {
    db.instance.exec(REGISTRY_TABLES_SQL);
    const floor = new DefaultModelRegistry(HEALTHY_CHECKER);
    const logger = createMockEventLogger();
    const svc = new ModelRegistryService(db, logger, config, floor, HEALTHY_CHECKER);

    const floorProviders = await floor.getAllProviders();
    assertEquals(await svc.getAllProviders(), floorProviders);
    // getContextWindow / getModelCapability / getModelsByCapability delegate too.
    assertEquals(
      await svc.getContextWindow("anthropic", "claude-opus-4-8"),
      await floor.getContextWindow("anthropic", "claude-opus-4-8"),
    );
    const cap = await svc.getModelCapability("anthropic", "claude-opus-4-8");
    assertExists(cap);
    assertEquals(
      (await svc.getModelsByCapability({})).length,
      (await floor.getModelsByCapability({})).length,
    );
  } finally {
    await cleanup();
  }
});

Deno.test("getProviderModels reads model_catalog rows when present", async () => {
  const { db, config, cleanup } = await initTestDbService();
  try {
    db.instance.exec(REGISTRY_TABLES_SQL);
    db.instance.exec(
      `INSERT INTO model_catalog (provider, model, context_window, max_output_tokens, supports_thinking, supports_effort, source, refreshed_at)
       VALUES ('anthropic', 'claude-test', 200000, 8192, 1, 1, 'endpoint', ${Date.now()})`,
    );
    const floor = new DefaultModelRegistry(HEALTHY_CHECKER);
    const logger = createMockEventLogger();
    const svc = new ModelRegistryService(db, logger, config, floor, HEALTHY_CHECKER);

    const rows = await svc.getProviderModels("anthropic");
    assertEquals(rows.length, 1);
    assertEquals(rows[0].model, "claude-test");
    assertEquals(rows[0].contextWindow, 200000);
  } finally {
    await cleanup();
  }
});

Deno.test("getModelPricing prefers model_pricing row with provenance + verifiedAt", async () => {
  const { db, config, cleanup } = await initTestDbService();
  try {
    db.instance.exec(REGISTRY_TABLES_SQL);
    const verifiedAt = Date.now();
    db.instance.prepare(
      `INSERT INTO model_pricing (provider, model, input_per_mtok, output_per_mtok, provenance, verified_at, source_url)
       VALUES ('anthropic', 'claude-test', 5.0, 25.0, 'endpoint', ?, 'https://x')`,
    ).run(verifiedAt);
    const floor = new DefaultModelRegistry(HEALTHY_CHECKER);
    const logger = createMockEventLogger();
    const svc = new ModelRegistryService(db, logger, config, floor, HEALTHY_CHECKER);

    const pricing = await svc.getModelPricing("anthropic", "claude-test");
    assertEquals(pricing.inputPerMtok, 5.0);
    assertEquals(pricing.outputPerMtok, 25.0);
    assertEquals(pricing.provenance, "endpoint");
    assertEquals(pricing.verifiedAt, verifiedAt);
    // getModelCost prefers per-Mtok input price over the floor.
    assertEquals(await svc.getModelCost("anthropic", "claude-test"), 5.0);
  } finally {
    await cleanup();
  }
});

Deno.test("stale static price emits model.pricing.stale and is still used", async () => {
  const { db, config, cleanup } = await initTestDbService();
  try {
    db.instance.exec(REGISTRY_TABLES_SQL);
    // A 'static' price verified 200 days ago exceeds the 90-day default staleness.
    const stale = Date.now() - 200 * 24 * 60 * 60 * 1000;
    db.instance.prepare(
      `INSERT INTO model_pricing (provider, model, input_per_mtok, output_per_mtok, provenance, verified_at)
       VALUES ('anthropic', 'claude-stale', 3.0, 15.0, 'static', ?)`,
    ).run(stale);
    const floor = new DefaultModelRegistry(HEALTHY_CHECKER);
    const logger = createMockEventLogger();
    const svc = new ModelRegistryService(db, logger, config, floor, HEALTHY_CHECKER);

    const pricing = await svc.getModelPricing("anthropic", "claude-stale");
    assertEquals(pricing.inputPerMtok, 3.0); // still used
    const staleEvents = logger.events.filter((e) => e.action === DomainEventType.ModelPricingStale);
    assertEquals(staleEvents.length, 1);
  } finally {
    await cleanup();
  }
});

Deno.test("recordLatency inserts; getLatencyStats aggregates; rankByLatency orders by p95 asc", async () => {
  const { db, config, cleanup } = await initTestDbService();
  try {
    db.instance.exec(REGISTRY_TABLES_SQL);
    const floor = new DefaultModelRegistry(HEALTHY_CHECKER);
    const logger = createMockEventLogger();
    const svc = new ModelRegistryService(db, logger, config, floor, HEALTHY_CHECKER);

    for (const ms of [100, 200, 300, 400, 500]) await svc.recordLatency("anthropic", "m1", ms);
    for (const ms of [10, 20, 30, 40, 50]) await svc.recordLatency("openai", "m2", ms);
    const stats = await svc.getLatencyStats("anthropic", "m1");
    assertEquals(stats.sampleCount, 5);
    assertEquals(stats.p50Ms >= 100 && stats.p50Ms <= 500, true);

    const ranked = await svc.rankByLatency([
      { provider: "anthropic", model: "m1" },
      { provider: "openai", model: "m2" },
    ]);
    // openai (faster p95) ranks first.
    assertEquals(ranked[0], "openai:m2");
  } finally {
    await cleanup();
  }
});

Deno.test("recordCall/getRateLimit upsert and read provider_rate_limit", async () => {
  const { db, config, cleanup } = await initTestDbService();
  try {
    db.instance.exec(REGISTRY_TABLES_SQL);
    const floor = new DefaultModelRegistry(HEALTHY_CHECKER);
    const logger = createMockEventLogger();
    const svc = new ModelRegistryService(db, logger, config, floor, HEALTHY_CHECKER);

    await svc.recordCall("anthropic");
    await svc.recordCall("anthropic");
    const rl = await svc.getRateLimit("anthropic");
    assertEquals(rl.maxRpm > 0, true);
    assertEquals(rl.remaining <= rl.maxRpm, true);
  } finally {
    await cleanup();
  }
});

Deno.test("getProviderHealth delegates to the injected checker and persists nothing (F3)", async () => {
  const { db, config, cleanup } = await initTestDbService();
  try {
    db.instance.exec(REGISTRY_TABLES_SQL);
    const floor = new DefaultModelRegistry(HEALTHY_CHECKER);
    const logger = createMockEventLogger();
    const degradedChecker = { checkProvider: (_p: string) => Promise.resolve(false) };
    const svc = new ModelRegistryService(db, logger, config, floor, degradedChecker);

    assertEquals(await svc.getProviderHealth("anthropic"), HealthStatus.DEGRADED);
    // No health table exists — nothing persisted.
    const tables = db.instance.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%health%'",
    ).all();
    assertEquals(tables.length, 0);
  } finally {
    await cleanup();
  }
});

// ── Edge cases (test-development §Edge case coverage) ────────────────────────

Deno.test("[edge][malformed] partial pricing row (input NULL, output set): getModelCost falls to floor, getModelPricing returns the row", async () => {
  const { db, config, cleanup } = await initTestDbService();
  try {
    db.instance.exec(REGISTRY_TABLES_SQL);
    // A row exists but input_per_mtok is NULL — getModelCost must not return NULL/NaN.
    db.instance.exec(
      `INSERT INTO model_pricing (provider, model, output_per_mtok, provenance)
       VALUES ('anthropic', 'claude-partial', 25.0, 'endpoint')`,
    );
    const floor = new DefaultModelRegistry(HEALTHY_CHECKER);
    const svc = new ModelRegistryService(db, createMockEventLogger(), config, floor, HEALTHY_CHECKER);

    const cost = await svc.getModelCost("anthropic", "claude-partial");
    assertEquals(typeof cost, "number");
    assertEquals(Number.isNaN(cost), false);
    // getModelPricing still returns the partial row with inputPerMtok undefined (not null).
    const pricing = await svc.getModelPricing("anthropic", "claude-partial");
    assertEquals(pricing.inputPerMtok, undefined);
    assertEquals(pricing.outputPerMtok, 25.0);
  } finally {
    await cleanup();
  }
});

Deno.test("[edge][negative] non-static (endpoint) stale price and static-with-null-verified_at do NOT emit model.pricing.stale", async () => {
  const { db, config, cleanup } = await initTestDbService();
  try {
    db.instance.exec(REGISTRY_TABLES_SQL);
    // Old but 'endpoint' provenance — staleness only applies to 'static' rows.
    const old = Date.now() - 500 * 24 * 60 * 60 * 1000;
    db.instance.prepare(
      `INSERT INTO model_pricing (provider, model, input_per_mtok, provenance, verified_at)
       VALUES ('anthropic', 'claude-endpoint', 5.0, 'endpoint', ?)`,
    ).run(old);
    // A static row with NULL verified_at must also not emit (no age known).
    db.instance.exec(
      `INSERT INTO model_pricing (provider, model, input_per_mtok, provenance)
       VALUES ('openai', 'gpt-x', 5.0, 'static')`,
    );
    const floor = new DefaultModelRegistry(HEALTHY_CHECKER);
    const logger = createMockEventLogger();
    const svc = new ModelRegistryService(db, logger, config, floor, HEALTHY_CHECKER);

    await svc.getModelPricing("anthropic", "claude-endpoint");
    await svc.getModelPricing("openai", "gpt-x");
    const stale = logger.events.filter((e) => e.action === DomainEventType.ModelPricingStale);
    assertEquals(stale.length, 0);
  } finally {
    await cleanup();
  }
});

Deno.test("[edge][roundtrip] large epoch-ms columns survive REAL storage without 32-bit truncation", async () => {
  const { db, config, cleanup } = await initTestDbService();
  try {
    db.instance.exec(REGISTRY_TABLES_SQL);
    const now = Date.now(); // > 2^31, would truncate in an INTEGER column
    db.instance.prepare(
      `INSERT INTO model_pricing (provider, model, input_per_mtok, provenance, verified_at)
       VALUES ('anthropic', 'claude-rt', 5.0, 'endpoint', ?)`,
    ).run(now);
    const floor = new DefaultModelRegistry(HEALTHY_CHECKER);
    const svc = new ModelRegistryService(db, createMockEventLogger(), config, floor, HEALTHY_CHECKER);

    const pricing = await svc.getModelPricing("anthropic", "claude-rt");
    assertEquals(pricing.verifiedAt, now); // exact round-trip, no truncation
  } finally {
    await cleanup();
  }
});

Deno.test("[edge][idempotency] recordCall decrements within a window, then resets remaining at the window boundary", async () => {
  const { db, config, cleanup } = await initTestDbService();
  try {
    db.instance.exec(REGISTRY_TABLES_SQL);
    const floor = new DefaultModelRegistry(HEALTHY_CHECKER);
    const svc = new ModelRegistryService(db, createMockEventLogger(), config, floor, HEALTHY_CHECKER);

    await svc.recordCall("anthropic");
    await svc.recordCall("anthropic");
    const mid = await svc.getRateLimit("anthropic");
    assertEquals(mid.remaining, mid.maxRpm - 2); // two calls decremented

    // Force the window to expire, then the next call resets remaining.
    db.instance.exec("UPDATE provider_rate_limit SET reset_at = 0 WHERE provider = 'anthropic'");
    await svc.recordCall("anthropic");
    const after = await svc.getRateLimit("anthropic");
    assertEquals(after.remaining, after.maxRpm - 1); // reset window: one call counted
  } finally {
    await cleanup();
  }
});

Deno.test("[edge][malformed] rankByLatency places candidates with no latency data last (no throw)", async () => {
  const { db, config, cleanup } = await initTestDbService();
  try {
    db.instance.exec(REGISTRY_TABLES_SQL);
    const floor = new DefaultModelRegistry(HEALTHY_CHECKER);
    const svc = new ModelRegistryService(db, createMockEventLogger(), config, floor, HEALTHY_CHECKER);

    await svc.recordLatency("anthropic", "m1", 100);
    // m2 has no latency rows — must rank last, not throw.
    const ranked = await svc.rankByLatency([
      { provider: "openai", model: "m2" },
      { provider: "anthropic", model: "m1" },
    ]);
    assertEquals(ranked[0], "anthropic:m1");
    assertEquals(ranked[1], "openai:m2");
  } finally {
    await cleanup();
  }
});
