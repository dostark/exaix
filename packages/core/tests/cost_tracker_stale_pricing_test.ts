/**
 * @module CostTrackerStalePricingTest
 * @path packages/core/tests/cost_tracker_stale_pricing_test.ts
 * @description Verifies that costing a request with an overlay price older than the configured threshold journals one model.pricing.stale event per model.
 * @architectural-layer Core
 * @related-files [packages/core/src/cost/cost_tracker.ts]
 */
import { assertEquals } from "@std/assert";
import { CostTracker } from "@exaix/core/cost";
import { initTestDbService } from "@exaix/testing";
import { createMockEventLogger } from "@exaix/testing/helpers/services/barrel.ts";
import { DomainEventType } from "@exaix/core/events";
import type { IModelPricing, IModelPricingLookup } from "@exaix/core/types";
import type { Config } from "@exaix/schemas";

const TRACE = "trace-stale";
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const TEN_DAYS_MS = 10 * MS_PER_DAY;

function lookupVerifiedAt(verifiedAt: number): IModelPricingLookup {
  return {
    getModelPricing(provider: string, model: string): Promise<IModelPricing> {
      return Promise.resolve({
        provider,
        model,
        inputPerMtok: 3,
        outputPerMtok: 15,
        provenance: "static",
        verifiedAt,
      });
    },
  };
}

async function staleEvents(verifiedAt: number, maxDays: number | undefined, calls: number) {
  const { db, config, cleanup } = await initTestDbService();
  const logger = createMockEventLogger();
  try {
    if (maxDays !== undefined) {
      config.model_registry = { ...config.model_registry, price_staleness_max_days: maxDays } as Config[
        "model_registry"
      ];
    }
    const tracker = new CostTracker(db, config, logger);
    tracker.setPricingLookup(lookupVerifiedAt(verifiedAt));
    for (let call = 0; call < calls; call++) {
      await tracker.trackGeneration("anthropic", "claude-x", {
        promptTokens: 10,
        completionTokens: 10,
        totalTokens: 20,
      }, TRACE);
    }
    await tracker.flush();
    return logger.events.filter((event) => event.action === DomainEventType.ModelPricingStale);
  } finally {
    await db.close();
    await cleanup();
  }
}

Deno.test("fix(cost): a price older than the configured threshold journals one stale event per model", async () => {
  const events = await staleEvents(Date.now() - TEN_DAYS_MS, 1, 2);
  assertEquals(events.length, 1);
  assertEquals(events[0].target, "anthropic:claude-x");
  assertEquals(events[0].traceId, TRACE);
});

Deno.test("fix(cost): a fresh price under the default threshold journals no stale event", async () => {
  assertEquals((await staleEvents(Date.now() - TEN_DAYS_MS, undefined, 1)).length, 0);
});
