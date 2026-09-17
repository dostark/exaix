/**
 * @module CostTrackerGenerationCacheTokensTest
 * @path packages/core/tests/cost_tracker_generation_cache_tokens_test.ts
 * @related-files [packages/core/src/cost/cost_tracker.ts]
 * @architectural-layer Core
 * @description CostTracker.trackGeneration — the entry point RateLimitedProvider calls
 * after every real generation — never accepted or forwarded cache-token fields, even
 * though persistEntry (a separate entry point used by session-delegate cost tracking)
 * already does, and provider_costs/queryByCriteria already store and return them.
 * Verifies trackGeneration forwards cacheReadTokens/cacheCreationTokens into a
 * queryable record, and that omitting them still records a valid (undefined) record.
 */

import { assertEquals } from "@std/assert";
import { CostTracker } from "@exaix/core/cost";
import { initTestDbService } from "@exaix/testing";
import { PROVIDER_ANTHROPIC } from "@exaix/ai-anthropic";

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

Deno.test("[CostTrackerGenerationCacheTokens] trackGeneration forwards cache-token fields into a queryable record", async () => {
  await withTracker(async (tracker) => {
    await tracker.trackGeneration(PROVIDER_ANTHROPIC, "claude-sonnet-5", {
      promptTokens: 8,
      completionTokens: 2428,
      totalTokens: 2436,
      cacheReadTokens: 134127,
      cacheCreationTokens: 19773,
    }, "trace-generation-cache-1");
    await tracker.flush();

    const results = await tracker.queryByCriteria({ traceId: "trace-generation-cache-1" });
    assertEquals(results.length, 1);
    assertEquals(results[0].cacheReadTokens, 134127);
    assertEquals(results[0].cacheCreationTokens, 19773);
  });
});

Deno.test("[CostTrackerGenerationCacheTokens] trackGeneration without cache fields records undefined, not 0", async () => {
  await withTracker(async (tracker) => {
    await tracker.trackGeneration(PROVIDER_ANTHROPIC, "claude-sonnet-5", {
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
    }, "trace-generation-no-cache-1");
    await tracker.flush();

    const results = await tracker.queryByCriteria({ traceId: "trace-generation-no-cache-1" });
    assertEquals(results.length, 1);
    assertEquals(results[0].cacheReadTokens, undefined);
    assertEquals(results[0].cacheCreationTokens, undefined);
  });
});
