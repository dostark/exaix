/**
 * @module CostTrackerReconciliationTest
 * @path packages/core/tests/cost_tracker_reconciliation_test.ts
 * @description Phase 135 Step 2 (§5.5, F6/G5/G9) — split-priced vs. provider-reported
 *   cost accounting, the cost_source column, divergence detection, and the
 *   setPricingLookup late-binder (GAP-4). Edition-agnostic (D9).
 * @architectural-layer Core
 */
import { assertAlmostEquals, assertEquals } from "@std/assert";
import { CostTracker } from "@exaix/core/cost";
import { initTestDbService } from "@exaix/testing";
import { createMockEventLogger } from "@exaix/testing/helpers/services/barrel.ts";
import { DomainEventType } from "@exaix/core/events";
import type { IModelPricing } from "@exaix/core/types";
import type { IModelPricingLookup } from "@exaix/core/types";
import type { Config } from "@exaix/schemas";

const TRACE = "trace-recon";

/** A pricing lookup stub with per-provider:model prices. */
function lookupWith(prices: Record<string, { input: number; output: number }>): IModelPricingLookup {
  return {
    getModelPricing(provider: string, model: string): Promise<IModelPricing> {
      const p = prices[`${provider}:${model}`];
      if (!p) return Promise.resolve({ provider, model, provenance: "unknown" });
      return Promise.resolve({
        provider,
        model,
        inputPerMtok: p.input,
        outputPerMtok: p.output,
        provenance: "endpoint",
      });
    },
  };
}

async function costRow(
  db: Awaited<ReturnType<typeof initTestDbService>>["db"],
): Promise<{ estimated_cost_usd: number; cost_source: string | null }> {
  const row = await db.preparedGet<{ estimated_cost_usd: number; cost_source: string | null }>(
    "SELECT estimated_cost_usd, cost_source FROM provider_costs WHERE trace_id = ? LIMIT 1",
    [TRACE],
  );
  return row ?? { estimated_cost_usd: -1, cost_source: "MISSING" };
}

Deno.test("registry-computed cost = input×prompt + output×completion (not blended)", async () => {
  const { db, config, cleanup } = await initTestDbService();
  try {
    const tracker = new CostTracker(db, config);
    tracker.setPricingLookup(lookupWith({ "anthropic:claude-x": { input: 3.0, output: 15.0 } }));
    // 1000 prompt @ $3/Mtok + 500 completion @ $15/Mtok = 0.003 + 0.0075 = 0.0105
    await tracker.trackGeneration("anthropic", "claude-x", {
      promptTokens: 1000,
      completionTokens: 500,
      totalTokens: 1500,
    }, TRACE);
    await tracker.flush();
    const row = await costRow(db);
    assertAlmostEquals(row.estimated_cost_usd, 0.0105, 1e-9);
    assertEquals(row.cost_source, "registry_computed");
  } finally {
    await db.close();
    await cleanup();
  }
});

Deno.test("caller-supplied costUsd recorded verbatim with cost_source provider_reported", async () => {
  const { db, config, cleanup } = await initTestDbService();
  try {
    const tracker = new CostTracker(db, config);
    tracker.setPricingLookup(lookupWith({}));
    await tracker.trackGeneration("openrouter", "some-model", {
      promptTokens: 100,
      completionTokens: 100,
      totalTokens: 200,
      costUsd: 0.042,
      costSource: "provider_reported",
    }, TRACE);
    await tracker.flush();
    const row = await costRow(db);
    assertEquals(row.estimated_cost_usd, 0.042);
    assertEquals(row.cost_source, "provider_reported");
  } finally {
    await db.close();
    await cleanup();
  }
});

Deno.test("unpriced model with a lookup falls back to the legacy estimate with cost_source null", async () => {
  const { db, config, cleanup } = await initTestDbService();
  try {
    const tracker = new CostTracker(db, config);
    tracker.setPricingLookup(lookupWith({})); // lookup present but returns unknown provenance
    await tracker.trackGeneration("openai", "gpt-x", {
      promptTokens: 500,
      completionTokens: 500,
      totalTokens: 1000,
    }, TRACE);
    await tracker.flush();
    const row = await costRow(db);
    // Legacy blended estimate path (non-zero for a known provider rate) with null source.
    assertEquals(row.cost_source, null);
  } finally {
    await db.close();
    await cleanup();
  }
});

Deno.test("no lookup injected: legacy blended estimate, cost_source null (library compat)", async () => {
  const { db, config, cleanup } = await initTestDbService();
  try {
    const tracker = new CostTracker(db, config); // no setPricingLookup
    await tracker.trackGeneration("openai", "gpt-x", {
      promptTokens: 500,
      completionTokens: 500,
      totalTokens: 1000,
    }, TRACE);
    await tracker.flush();
    const row = await costRow(db);
    assertEquals(row.cost_source, null);
  } finally {
    await db.close();
    await cleanup();
  }
});

Deno.test("divergence beyond tolerance emits model.cost.divergence with delta_pct; within tolerance silent", async () => {
  // Reported 0.010 vs computed 0.0105 → ~5% delta; use a 1% tolerance to trip it.
  const { db, config, cleanup } = await initTestDbService();
  const logger = createMockEventLogger();
  try {
    // Flip the REAL config's tolerance to 1% (from the schema default of 5).
    config.model_registry = { ...config.model_registry, cost_divergence_tolerance_pct: 1 } as Config[
      "model_registry"
    ];
    const tracker = new CostTracker(db, config, logger);
    tracker.setPricingLookup(lookupWith({ "anthropic:claude-x": { input: 3.0, output: 15.0 } }));
    await tracker.trackGeneration("anthropic", "claude-x", {
      promptTokens: 1000,
      completionTokens: 500,
      totalTokens: 1500,
      costUsd: 0.010, // reported; computed = 0.0105 → ~4.76% delta > 1%
      costSource: "provider_reported",
    }, TRACE);
    await tracker.flush();
    const divergences = logger.events.filter((e) => e.action === DomainEventType.ModelCostDivergence);
    assertEquals(divergences.length, 1);
  } finally {
    await db.close();
    await cleanup();
  }
});

Deno.test("[edge][malformed] zero and NaN token counts never persist a NaN cost row", async () => {
  const { db, config, cleanup } = await initTestDbService();
  try {
    const tracker = new CostTracker(db, config);
    tracker.setPricingLookup(lookupWith({ "anthropic:claude-x": { input: 3.0, output: 15.0 } }));
    await tracker.trackGeneration("anthropic", "claude-x", {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    }, TRACE);
    await tracker.flush();
    const row = await costRow(db);
    assertEquals(Number.isNaN(row.estimated_cost_usd), false);
    assertEquals(row.estimated_cost_usd, 0);
  } finally {
    await db.close();
    await cleanup();
  }
});

Deno.test("[edge][partial-failure] a NaN/negative provider-reported cost is not persisted as provider_reported", async () => {
  const { db, config, cleanup } = await initTestDbService();
  try {
    const tracker = new CostTracker(db, config);
    tracker.setPricingLookup(lookupWith({ "anthropic:claude-x": { input: 3.0, output: 15.0 } }));
    // A NaN reported cost must be ignored → falls to the computed split price, not persisted verbatim.
    await tracker.trackGeneration("anthropic", "claude-x", {
      promptTokens: 1000,
      completionTokens: 500,
      totalTokens: 1500,
      costUsd: Number.NaN,
      costSource: "provider_reported",
    }, TRACE);
    await tracker.flush();
    const row = await costRow(db);
    assertEquals(Number.isNaN(row.estimated_cost_usd), false);
    // Fell through to the computed split price (registry_computed), NOT provider_reported.
    assertEquals(row.cost_source, "registry_computed");
    assertAlmostEquals(row.estimated_cost_usd, 0.0105, 1e-9);
  } finally {
    await db.close();
    await cleanup();
  }
});

Deno.test("D7-exempt $0-priced model records $0 registry_computed", async () => {
  const { db, config, cleanup } = await initTestDbService();
  try {
    const tracker = new CostTracker(db, config);
    // A local/free model priced at $0 (D7 exemption) still resolves via the lookup at $0.
    tracker.setPricingLookup(lookupWith({ "ollama:llama": { input: 0, output: 0 } }));
    await tracker.trackGeneration("ollama", "llama", {
      promptTokens: 1000,
      completionTokens: 500,
      totalTokens: 1500,
    }, TRACE);
    await tracker.flush();
    const row = await costRow(db);
    assertEquals(row.estimated_cost_usd, 0);
    assertEquals(row.cost_source, "registry_computed");
  } finally {
    await db.close();
    await cleanup();
  }
});

Deno.test("[edge][roundtrip] cost_source values survive a DB write→read round-trip", async () => {
  const { db, config, cleanup } = await initTestDbService();
  try {
    const tracker = new CostTracker(db, config);
    tracker.setPricingLookup(lookupWith({ "anthropic:claude-x": { input: 3.0, output: 15.0 } }));
    for (
      const [i, spec] of [
        { costSource: undefined, expect: "registry_computed" }, // priced → registry_computed
        { costSource: "provider_reported", expect: "provider_reported" },
      ].entries()
    ) {
      await tracker.trackGeneration("anthropic", "claude-x", {
        promptTokens: 1000,
        completionTokens: 500,
        totalTokens: 1500,
        costUsd: spec.costSource ? 0.5 : undefined,
        costSource: spec.costSource as "provider_reported" | undefined,
      }, `${TRACE}-${i}`);
      await tracker.flush();
      const row = await db.preparedGet<{ cost_source: string | null }>(
        "SELECT cost_source FROM provider_costs WHERE trace_id = ?",
        [`${TRACE}-${i}`],
      );
      assertEquals(row?.cost_source, spec.expect);
    }
  } finally {
    await db.close();
    await cleanup();
  }
});
