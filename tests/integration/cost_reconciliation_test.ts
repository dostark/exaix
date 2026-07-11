/**
 * @module CostReconciliationIntegrationTest
 * @path tests/integration/cost_reconciliation_test.ts
 * @description Phase 135 Step 2 (D9) — the CostTracker↔registry seam end-to-end:
 *   the Solo floor (DefaultModelRegistry) injected as the pricing lookup prices a
 *   generation from its static overlay split prices (accuracy without Team), and the
 *   Solo default divergence tolerance resolves with no model_registry config block.
 * @architectural-layer Integration
 */
import { assertAlmostEquals, assertEquals } from "@std/assert";
import { CostTracker } from "@exaix/core/cost";
import { DefaultModelRegistry } from "@exaix/model-registry";
import { initTestDbService } from "@exaix/testing";

const HEALTHY = { checkProvider: (_p: string) => Promise.resolve(true) };
const TRACE = "trace-d9";

Deno.test("[d9] Solo floor injected as pricing lookup prices from static overlay split prices", async () => {
  const { db, config, cleanup } = await initTestDbService();
  try {
    const tracker = new CostTracker(db, config);
    // The edition-selected registry in Solo IS the DefaultModelRegistry floor.
    tracker.setPricingLookup(new DefaultModelRegistry(HEALTHY));

    // claude-sonnet-5 overlay: input 3.00/Mtok, output 15.00/Mtok.
    // 2000 prompt @ 3.00 + 1000 completion @ 15.00 = 0.006 + 0.015 = 0.021
    await tracker.trackGeneration("anthropic", "claude-sonnet-5", {
      promptTokens: 2000,
      completionTokens: 1000,
      totalTokens: 3000,
    }, TRACE);
    await tracker.flush();

    const row = await db.preparedGet<{ estimated_cost_usd: number; cost_source: string | null }>(
      "SELECT estimated_cost_usd, cost_source FROM provider_costs WHERE trace_id = ?",
      [TRACE],
    );
    assertAlmostEquals(row?.estimated_cost_usd ?? -1, 0.021, 1e-9);
    assertEquals(row?.cost_source, "registry_computed");
  } finally {
    await db.close();
    await cleanup();
  }
});

Deno.test("[gap6] Solo tracker with no model_registry config block still resolves the divergence default", async () => {
  const { db, cleanup } = await initTestDbService();
  try {
    // No model_registry block — the divergence tolerance must fall to the constant.
    const tracker = new CostTracker(db, undefined);
    tracker.setPricingLookup(new DefaultModelRegistry(HEALTHY));
    // Reported == computed → no divergence regardless of tolerance; asserts no throw
    // on the nullish-config read path.
    await tracker.trackGeneration("anthropic", "claude-sonnet-5", {
      promptTokens: 2000,
      completionTokens: 1000,
      totalTokens: 3000,
      costUsd: 0.021,
      costSource: "provider_reported",
    }, TRACE);
    await tracker.flush();
    const row = await db.preparedGet<{ cost_source: string | null }>(
      "SELECT cost_source FROM provider_costs WHERE trace_id = ?",
      [TRACE],
    );
    assertEquals(row?.cost_source, "provider_reported");
  } finally {
    await db.close();
    await cleanup();
  }
});
