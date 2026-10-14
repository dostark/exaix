/**
 * @module OpenRouterCostRatesTest
 * @path packages/ai-openrouter/tests/openrouter_cost_rates_test.ts
 * @description Verifies the cost tracker preserves reported OpenRouter USD without inventing a flat price.
 * @architectural-layer AI
 * @dependencies [@exaix/core, @exaix/testing, @std/assert]
 * @related-files [packages/ai-openrouter/src/constants.ts, packages/core/src/cost/cost_tracker.ts]
 */
import { assertEquals } from "@std/assert";
import { CostTracker } from "@exaix/core/cost";
import { initTestDbService } from "@exaix/testing";

Deno.test("OpenRouter cost tracker preserves reported USD, including zero, without a provider ranking estimate", async () => {
  const { db, cleanup } = await initTestDbService();
  const tracker = new CostTracker(db);
  try {
    for (const costUsd of [0.0123, 0]) {
      assertEquals(
        await tracker.trackGeneration("openrouter", "vendor/model", {
          promptTokens: 600,
          completionTokens: 400,
          totalTokens: 1000,
          costUsd,
        }),
        costUsd,
      );
    }
  } finally {
    await tracker.flush();
    await cleanup();
  }
});

Deno.test("OpenRouter cost tracker keeps the zero sentinel when no price or reported cost is available", async () => {
  const { db, cleanup } = await initTestDbService();
  const tracker = new CostTracker(db);
  try {
    assertEquals(
      await tracker.trackGeneration("openrouter", "vendor/unpriced", {
        promptTokens: 600,
        completionTokens: 400,
        totalTokens: 1000,
      }),
      0,
    );
  } finally {
    await tracker.flush();
    await cleanup();
  }
});
