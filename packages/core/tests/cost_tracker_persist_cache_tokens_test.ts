/**
 * @module CostTrackerPersistCacheTokensTest
 * @path packages/core/tests/cost_tracker_persist_cache_tokens_test.ts
 * @related-files [packages/core/src/cost/cost_tracker.ts]
 * @architectural-layer Core
 * @description Phase 140a Step 2/GAP-4 — RED-first tests. CostTracker.persistEntry
 * currently forwards only provider/tokens/model/traceId/portal/promptTokens/
 * completionTokens to trackRequest — it neither forwards the widened
 * IProviderCostRecord's cache-token fields, nor the caller's already-known real
 * estimatedCostUsd (so a real, tracked cost silently gets re-priced by resolveCost's
 * registry-computed/legacy-estimate fallback instead of being trusted). Verifies
 * persistEntry forwards cache-token fields into provider_costs, preserves a real
 * estimatedCostUsd as cost_source='provider_reported' rather than recomputing it, and
 * that queryByCriteria reads cost_source back (the column already exists on the table
 * but was never selected).
 */

import { assertEquals } from "@std/assert";
import { CostTracker } from "@exaix/core/cost";
import { initTestDbService } from "@exaix/testing";
import type { IProviderCostRecord } from "@exaix/core/types";

async function withTracker(testFn: (tracker: CostTracker) => Promise<void>): Promise<void> {
  const { db, cleanup } = await initTestDbService();
  try {
    const tracker = new CostTracker(db);
    await testFn(tracker);
    await db.close();
  } finally {
    await cleanup();
  }
}

function makeCostRecord(overrides: Partial<IProviderCostRecord> = {}): IProviderCostRecord {
  return {
    id: crypto.randomUUID(),
    provider: "session:opencode",
    model: "unknown",
    tokens: 150,
    promptTokens: 100,
    completionTokens: 50,
    estimatedCostUsd: 0.05,
    timestamp: new Date(),
    cacheReadTokens: 20,
    cacheCreationTokens: 80,
    ...overrides,
  };
}

Deno.test("[CostTrackerPersistCacheTokens] persistEntry forwards cache-token fields into provider_costs", async () => {
  await withTracker(async (tracker) => {
    const record = makeCostRecord({ traceId: "trace-cache-1" });
    await tracker.persistEntry(record);
    await tracker.flush();

    const results = await tracker.queryByCriteria({ traceId: "trace-cache-1" });
    assertEquals(results.length, 1);
    assertEquals(results[0].cacheReadTokens, 20);
    assertEquals(results[0].cacheCreationTokens, 80);
  });
});

Deno.test("[CostTrackerPersistCacheTokens] persistEntry preserves a real estimatedCostUsd as provider_reported, not re-priced", async () => {
  await withTracker(async (tracker) => {
    const record = makeCostRecord({ traceId: "trace-cost-1", estimatedCostUsd: 0.12345 });
    await tracker.persistEntry(record);
    await tracker.flush();

    const results = await tracker.queryByCriteria({ traceId: "trace-cost-1" });
    assertEquals(results.length, 1);
    assertEquals(results[0].estimatedCostUsd, 0.12345);
  });
});

Deno.test("[CostTrackerPersistCacheTokens] queryByCriteria returns cost_source for a persisted record", async () => {
  await withTracker(async (tracker) => {
    const record = makeCostRecord({ traceId: "trace-source-1" });
    await tracker.persistEntry(record);
    await tracker.flush();

    const results = await tracker.queryByCriteria({ traceId: "trace-source-1" });
    assertEquals(results.length, 1);
    assertEquals(results[0].costSource, "provider_reported");
  });
});
