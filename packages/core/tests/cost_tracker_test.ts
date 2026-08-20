/**
 * @module CostTrackerTest
 * @path packages/core/tests/cost_tracker_test.ts
 * @related-files []
 * @architectural-layer Core
 * @description Validates the CostTracker's ability to monitor LLM usage, aggregate token metrics
 * across different pricing tiers, and persist usage statistics for budgetary oversight.
 */

import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import { CostTracker } from "@exaix/core/cost";
import { initTestDbService } from "@exaix/testing";
import { createMockEventLogger } from "@exaix/testing";
import { EventLogger } from "@exaix/core/logger";
import { COST_RATE_ANTHROPIC, COST_RATE_OPENAI, TOKENS_PER_COST_UNIT } from "@exaix/core";
import { DomainEventType } from "@exaix/core/events";
import { PROVIDER_ANTHROPIC } from "@exaix/ai-anthropic";
import { PROVIDER_OPENAI } from "@exaix/ai-openai";

/**
 * Tests for CostTracker service.
 *
 * Success Criteria:
 * - Tracks individual requests with token counts and cost estimates
 * - Calculates daily costs accurately
 * - Enforces budget limits correctly
 * - Provides cost summaries for date ranges
 * - Handles multiple providers independently
 * - Uses correct cost rates for different providers
 */

const COST_PER_TOKEN_OPENAI = COST_RATE_OPENAI / TOKENS_PER_COST_UNIT;
const COST_PER_TOKEN_ANTHROPIC = COST_RATE_ANTHROPIC / TOKENS_PER_COST_UNIT;

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

Deno.test("CostTracker: tracks single request", async () => {
  await withTracker(async (tracker) => {
    await tracker.trackGeneration(PROVIDER_OPENAI, "gpt-4", {
      promptTokens: 500,
      completionTokens: 500,
      totalTokens: 1000,
    });
    await tracker.flush(); // Flush batch for immediate write

    const dailyCost = await tracker.getDailyCost(PROVIDER_OPENAI);
    // 1000 tokens * COST_PER_TOKEN_OPENAI
    const expectedCost = 1000 * COST_PER_TOKEN_OPENAI;
    assertEquals(dailyCost, expectedCost);
  });
});

Deno.test("CostTracker: accumulates multiple requests", async () => {
  await withTracker(async (tracker) => {
    await tracker.trackGeneration(PROVIDER_OPENAI, "gpt-4", {
      promptTokens: 500,
      completionTokens: 500,
      totalTokens: 1000,
    });
    await tracker.trackGeneration(PROVIDER_OPENAI, "gpt-4", {
      promptTokens: 1000,
      completionTokens: 1000,
      totalTokens: 2000,
    });
    await tracker.flush(); // Flush batch for immediate write

    const dailyCost = await tracker.getDailyCost(PROVIDER_OPENAI);
    // (1000 + 2000) tokens * COST_PER_TOKEN_OPENAI
    const expectedCost = 3000 * COST_PER_TOKEN_OPENAI;
    assertEquals(dailyCost, expectedCost);
  });
});

Deno.test("CostTracker: handles different providers", async () => {
  await withTracker(async (tracker) => {
    await tracker.trackGeneration(PROVIDER_OPENAI, "gpt-4", {
      promptTokens: 500,
      completionTokens: 500,
      totalTokens: 1000,
    });
    await tracker.trackGeneration(PROVIDER_ANTHROPIC, "claude", {
      promptTokens: 500,
      completionTokens: 500,
      totalTokens: 1000,
    });
    await tracker.flush(); // Flush batch for immediate write

    const openaiCost = await tracker.getDailyCost(PROVIDER_OPENAI);
    const anthropicCost = await tracker.getDailyCost(PROVIDER_ANTHROPIC);

    assertEquals(openaiCost, 1000 * COST_PER_TOKEN_OPENAI);
    assertEquals(anthropicCost, 1000 * COST_PER_TOKEN_ANTHROPIC);
  });
});

Deno.test("CostTracker: free providers cost zero", async () => {
  await withTracker(async (tracker) => {
    await tracker.trackGeneration("ollama", "llama", {
      promptTokens: 5000,
      completionTokens: 5000,
      totalTokens: 10000,
    });
    // Google is no longer free, so removing it from this test
    // await tracker.trackRequest("google", 10000);
    await tracker.trackGeneration("mock", "mock", { promptTokens: 5000, completionTokens: 5000, totalTokens: 10000 });
    await tracker.flush(); // Flush batch for immediate write

    const ollamaCost = await tracker.getDailyCost("ollama");
    // const googleCost = await tracker.getDailyCost("google");
    const mockCost = await tracker.getDailyCost("mock");

    assertEquals(ollamaCost, 0);
    // assertEquals(googleCost, 0);
    assertEquals(mockCost, 0);
  });
});

Deno.test("CostTracker: isWithinBudget returns true when under budget", async () => {
  await withTracker(async (tracker) => {
    await tracker.trackGeneration(PROVIDER_OPENAI, "gpt-4", {
      promptTokens: 250,
      completionTokens: 250,
      totalTokens: 500,
    }); // $0.001
    await tracker.flush(); // Flush batch for immediate write

    const withinBudget = await tracker.isWithinBudget(PROVIDER_OPENAI, 0.01);
    assert(withinBudget);
  });
});

Deno.test("CostTracker: isWithinBudget returns false when over budget", async () => {
  await withTracker(async (tracker) => {
    await tracker.trackGeneration(PROVIDER_OPENAI, "gpt-4", {
      promptTokens: 7500,
      completionTokens: 7500,
      totalTokens: 15000,
    }); // $0.030
    await tracker.flush(); // Flush batch for immediate write

    const exceededBudget = await tracker.isWithinBudget(PROVIDER_OPENAI, 0.01);
    assert(!exceededBudget);
  });
});

Deno.test("CostTracker: getDailyCost without provider sums all", async () => {
  await withTracker(async (tracker) => {
    await tracker.trackGeneration(PROVIDER_OPENAI, "gpt-4", {
      promptTokens: 500,
      completionTokens: 500,
      totalTokens: 1000,
    }); // $0.002
    await tracker.trackGeneration(PROVIDER_ANTHROPIC, "claude-3", {
      promptTokens: 1000,
      completionTokens: 1000,
      totalTokens: 2000,
    }); // $0.010
    await tracker.flush(); // Flush batch for immediate write

    const totalCost = await tracker.getDailyCost();
    const expectedTotal = (1000 * COST_PER_TOKEN_OPENAI) + (2000 * COST_PER_TOKEN_ANTHROPIC);
    assertAlmostEquals(totalCost, expectedTotal);
  });
});

Deno.test("CostTracker: getCostSummary returns records in date range", async () => {
  await withTracker(async (tracker) => {
    const startDate = new Date();
    startDate.setHours(0, 0, 0, 0);
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + 1);

    await tracker.trackGeneration(PROVIDER_OPENAI, "gpt-4", {
      promptTokens: 500,
      completionTokens: 500,
      totalTokens: 1000,
    });
    await tracker.trackGeneration(PROVIDER_ANTHROPIC, "claude-3", {
      promptTokens: 1000,
      completionTokens: 1000,
      totalTokens: 2000,
    });
    await tracker.flush(); // Flush batch for immediate write

    const summary = await tracker.getCostSummary(startDate, endDate);

    assertEquals(summary.length, 2);
    assertEquals(summary[0].provider, PROVIDER_ANTHROPIC); // Most recent first
    assertEquals(summary[0].tokens, 2000);
    assertEquals(summary[0].estimatedCostUsd, 2000 * COST_PER_TOKEN_ANTHROPIC);
    assertEquals(summary[1].provider, PROVIDER_OPENAI);
    assertEquals(summary[1].tokens, 1000);
    assertEquals(summary[1].estimatedCostUsd, 1000 * COST_PER_TOKEN_OPENAI);
  });
});

Deno.test("CostTracker: getCostSummary filters by provider", async () => {
  await withTracker(async (tracker) => {
    const startDate = new Date();
    startDate.setHours(0, 0, 0, 0);
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + 1);

    await tracker.trackGeneration(PROVIDER_OPENAI, "gpt-4", {
      promptTokens: 500,
      completionTokens: 500,
      totalTokens: 1000,
    });
    await tracker.trackGeneration(PROVIDER_ANTHROPIC, "claude-3", {
      promptTokens: 1000,
      completionTokens: 1000,
      totalTokens: 2000,
    });
    await tracker.flush(); // Flush batch for immediate write

    const openaiSummary = await tracker.getCostSummary(startDate, endDate, PROVIDER_OPENAI);

    assertEquals(openaiSummary.length, 1);
    assertEquals(openaiSummary[0].provider, PROVIDER_OPENAI);
  });
});

Deno.test("CostTracker: queryByCriteria filters by traceId and portal", async () => {
  await withTracker(async (tracker) => {
    const traceId = crypto.randomUUID();
    const portal = "test-portal";

    await tracker.trackGeneration(
      PROVIDER_OPENAI,
      "gpt-4",
      {
        promptTokens: 400,
        completionTokens: 600,
        totalTokens: 1000,
      },
      traceId,
      portal,
    );
    await tracker.flush();

    const results = await tracker.queryByCriteria({ traceId, portal });
    assertEquals(results.length, 1);
    assertEquals(results[0].traceId, traceId);
    assertEquals(results[0].portal, portal);
    assertEquals(results[0].model, "gpt-4");
    assertEquals(results[0].promptTokens, 400);
    assertEquals(results[0].completionTokens, 600);
    assertEquals(results[0].tokens, 1000);
  });
});

Deno.test("CostTracker: setPricingLookup emits CostPricingLookupSet", async () => {
  const { db, cleanup } = await initTestDbService();
  const logger = createMockEventLogger();
  try {
    const tracker = new CostTracker(db, undefined, logger);
    tracker.setPricingLookup({
      getModelPricing: (provider: string, model: string) =>
        Promise.resolve({ provider, model, provenance: "endpoint" as const }),
    });

    const events = logger.events.filter((e) => e.action === DomainEventType.CostPricingLookupSet);
    assertEquals(events.length, 1);
    assertEquals(events[0].target, "pricing_lookup");
    assertEquals(events[0].payload?.configured, true);

    await db.close();
  } finally {
    await cleanup();
  }
});

Deno.test("CostTracker: queryByCriteria emits CostQueriedByCriteria with result count", async () => {
  const { db, cleanup } = await initTestDbService();
  const logger = createMockEventLogger();
  try {
    const tracker = new CostTracker(db, undefined, logger);
    const traceId = crypto.randomUUID();

    await tracker.trackGeneration(PROVIDER_OPENAI, "gpt-4", {
      promptTokens: 400,
      completionTokens: 600,
      totalTokens: 1000,
    }, traceId);
    await tracker.flush();

    await tracker.queryByCriteria({ traceId });

    const events = logger.events.filter((e) => e.action === DomainEventType.CostQueriedByCriteria);
    assertEquals(events.length, 1);
    assertEquals(events[0].target, traceId);
    assertEquals(events[0].payload?.resultCount, 1);
    assertEquals(events[0].payload?.traceId, traceId);

    await db.close();
  } finally {
    await cleanup();
  }
});

Deno.test("CostTracker: getDailyCost emits CostDailyCostQueried with total", async () => {
  const { db, cleanup } = await initTestDbService();
  const logger = createMockEventLogger();
  try {
    const tracker = new CostTracker(db, undefined, logger);

    await tracker.trackGeneration(PROVIDER_OPENAI, "gpt-4", {
      promptTokens: 500,
      completionTokens: 500,
      totalTokens: 1000,
    });
    await tracker.flush();

    const totalCost = await tracker.getDailyCost(PROVIDER_OPENAI);

    const events = logger.events.filter((e) => e.action === DomainEventType.CostDailyCostQueried);
    assertEquals(events.length, 1);
    assertEquals(events[0].target, PROVIDER_OPENAI);
    assertEquals(events[0].payload?.provider, PROVIDER_OPENAI);
    assertAlmostEquals(events[0].payload?.totalCost as number, totalCost);

    await db.close();
  } finally {
    await cleanup();
  }
});

Deno.test("CostTracker: getCostSummary emits CostSummaryQueried with result count", async () => {
  const { db, cleanup } = await initTestDbService();
  const logger = createMockEventLogger();
  try {
    const tracker = new CostTracker(db, undefined, logger);
    const startDate = new Date();
    startDate.setHours(0, 0, 0, 0);
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + 1);

    await tracker.trackGeneration(PROVIDER_OPENAI, "gpt-4", {
      promptTokens: 500,
      completionTokens: 500,
      totalTokens: 1000,
    });
    await tracker.flush();

    const summary = await tracker.getCostSummary(startDate, endDate);

    const events = logger.events.filter((e) => e.action === DomainEventType.CostSummaryQueried);
    assertEquals(events.length, 1);
    assertEquals(events[0].payload?.resultCount, summary.length);
    assertEquals(events[0].payload?.startDate, startDate.toISOString());
    assertEquals(events[0].payload?.endDate, endDate.toISOString());

    await db.close();
  } finally {
    await cleanup();
  }
});

Deno.test("CostTracker: flush emits CostBatchFlushed with pending count", async () => {
  const { db, cleanup } = await initTestDbService();
  const logger = createMockEventLogger();
  try {
    const tracker = new CostTracker(db, undefined, logger);

    await tracker.trackGeneration(PROVIDER_OPENAI, "gpt-4", {
      promptTokens: 500,
      completionTokens: 500,
      totalTokens: 1000,
    });
    await tracker.flush();

    const events = logger.events.filter((e) => e.action === DomainEventType.CostBatchFlushed);
    assertEquals(events.length, 1);
    assertEquals(events[0].target, "cost_batch");
    assertEquals(events[0].payload?.pendingCount, 1);

    await db.close();
  } finally {
    await cleanup();
  }
});

Deno.test("CostTracker: flush emits cost.batch.flushed with a real, field-level payload (real EventLogger)", async () => {
  const { db, cleanup } = await initTestDbService();
  try {
    const logger = new EventLogger({ db });
    const tracker = new CostTracker(db, undefined, logger);

    await tracker.trackGeneration(PROVIDER_OPENAI, "gpt-4", {
      promptTokens: 100,
      completionTokens: 200,
      totalTokens: 300,
    });
    await tracker.flush();
    await db.waitForFlush();

    const rows = db.instance.prepare(
      "SELECT payload FROM activity WHERE action_type = ? ORDER BY timestamp DESC LIMIT 1",
    ).all(DomainEventType.CostBatchFlushed) as Array<{ payload: string }>;
    assertEquals(rows.length, 1, "cost.batch.flushed must be logged exactly once");
    const payload = JSON.parse(rows[0].payload);
    assertEquals(payload.pendingCount, 1);

    await db.close();
  } finally {
    await cleanup();
  }
});

Deno.test("CostTracker: trackGeneration emits model.cost.divergence with a real, field-level payload when reported and computed costs differ (real EventLogger)", async () => {
  const { db, cleanup } = await initTestDbService();
  try {
    const logger = new EventLogger({ db });
    const tracker = new CostTracker(db, undefined, logger);
    tracker.setPricingLookup({
      getModelPricing: (provider: string, model: string) =>
        Promise.resolve({ provider, model, provenance: "endpoint" as const, inputPerMtok: 10, outputPerMtok: 30 }),
    });

    // reported ($100) deliberately far from the computed split price
    // ((10 * 1_000_000 + 30 * 1_000_000) / 1_000_000 = $40) to clear the default tolerance.
    await tracker.trackGeneration(PROVIDER_OPENAI, "gpt-4", {
      promptTokens: 1_000_000,
      completionTokens: 1_000_000,
      totalTokens: 2_000_000,
      costUsd: 100,
    });
    await db.waitForFlush();

    const rows = db.instance.prepare(
      "SELECT payload FROM activity WHERE action_type = ? ORDER BY timestamp DESC LIMIT 1",
    ).all(DomainEventType.ModelCostDivergence) as Array<{ payload: string }>;
    assertEquals(rows.length, 1, "model.cost.divergence must be logged exactly once");
    const payload = JSON.parse(rows[0].payload);
    assertEquals(payload.provider, PROVIDER_OPENAI);
    assertEquals(payload.model, "gpt-4");
    assertEquals(payload.reported, 100);
    assertEquals(payload.computed, 40);

    await db.close();
  } finally {
    await cleanup();
  }
});
