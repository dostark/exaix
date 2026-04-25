/**
 * @module CostTrackerTest
 * @path tests/services/ai/cost_tracker_test.ts
 * @description Validates the CostTracker's ability to monitor LLM usage, aggregate token metrics
 * across different pricing tiers, and persist usage statistics for budgetary oversight.
 */

import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import { CostTracker } from "../../../src/services/cost/cost_tracker.ts";
import { initTestDbService } from "../../helpers/db.ts";
import { COST_RATE_ANTHROPIC, COST_RATE_OPENAI, TOKENS_PER_COST_UNIT } from "@exaix/core";
import { PROVIDER_ANTHROPIC, PROVIDER_OPENAI } from "@exaix/ai";

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

Deno.test("CostTracker: tracks single request", async () => {
  const { db, cleanup } = await initTestDbService();
  try {
    const tracker = new CostTracker(db);

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

    await db.close();
  } finally {
    await cleanup();
  }
});

Deno.test("CostTracker: accumulates multiple requests", async () => {
  const { db, cleanup } = await initTestDbService();
  try {
    const tracker = new CostTracker(db);

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

    await db.close();
  } finally {
    await cleanup();
  }
});

Deno.test("CostTracker: handles different providers", async () => {
  const { db, cleanup } = await initTestDbService();
  try {
    const tracker = new CostTracker(db);

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

    await db.close();
  } finally {
    await cleanup();
  }
});

Deno.test("CostTracker: free providers cost zero", async () => {
  const { db, cleanup } = await initTestDbService();
  try {
    const tracker = new CostTracker(db);

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

    await db.close();
  } finally {
    await cleanup();
  }
});

Deno.test("CostTracker: isWithinBudget returns true when under budget", async () => {
  const { db, cleanup } = await initTestDbService();
  try {
    const tracker = new CostTracker(db);

    await tracker.trackGeneration(PROVIDER_OPENAI, "gpt-4", {
      promptTokens: 250,
      completionTokens: 250,
      totalTokens: 500,
    }); // $0.001
    await tracker.flush(); // Flush batch for immediate write

    const withinBudget = await tracker.isWithinBudget(PROVIDER_OPENAI, 0.01);
    assert(withinBudget);

    await db.close();
  } finally {
    await cleanup();
  }
});

Deno.test("CostTracker: isWithinBudget returns false when over budget", async () => {
  const { db, cleanup } = await initTestDbService();
  try {
    const tracker = new CostTracker(db);

    await tracker.trackGeneration(PROVIDER_OPENAI, "gpt-4", {
      promptTokens: 7500,
      completionTokens: 7500,
      totalTokens: 15000,
    }); // $0.030
    await tracker.flush(); // Flush batch for immediate write

    const exceededBudget = await tracker.isWithinBudget(PROVIDER_OPENAI, 0.01);
    assert(!exceededBudget);

    await db.close();
  } finally {
    await cleanup();
  }
});

Deno.test("CostTracker: getDailyCost without provider sums all", async () => {
  const { db, cleanup } = await initTestDbService();
  try {
    const tracker = new CostTracker(db);

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

    await db.close();
  } finally {
    await cleanup();
  }
});

Deno.test("CostTracker: getCostSummary returns records in date range", async () => {
  const { db, cleanup } = await initTestDbService();
  try {
    const tracker = new CostTracker(db);

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

    await db.close();
  } finally {
    await cleanup();
  }
});

Deno.test("CostTracker: getCostSummary filters by provider", async () => {
  const { db, cleanup } = await initTestDbService();
  try {
    const tracker = new CostTracker(db);

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

    await db.close();
  } finally {
    await cleanup();
  }
});

Deno.test("CostTracker: queryByCriteria filters by traceId and portal", async () => {
  const { db, cleanup } = await initTestDbService();
  try {
    const tracker = new CostTracker(db);
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

    await db.close();
  } finally {
    await cleanup();
  }
});
