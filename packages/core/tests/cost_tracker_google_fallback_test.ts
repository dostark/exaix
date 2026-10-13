/**
 * @module CostTrackerGoogleFallbackTest
 * @path packages/core/tests/cost_tracker_google_fallback_test.ts
 * @related-files ["packages/core/src/cost/cost_tracker.ts", "packages/core/src/types/constants.ts"]
 * @architectural-layer Core
 * @description When no reported cost and no registry price exists, the legacy estimate for Gemini
 * must price prompt tokens at the input rate and the remaining tokens (answer and thinking) at the
 * output rate. Pricing every token at the output rate overstates the cost of a Gemini call.
 */

import { assertAlmostEquals } from "@std/assert";
import { CostTracker } from "@exaix/core/cost";
import { COST_RATE_GOOGLE, COST_RATE_GOOGLE_INPUT, ProviderType, TOKENS_PER_COST_UNIT } from "@exaix/core";
import { initTestDbService } from "@exaix/testing";

const MILLION = 1_000_000;
const THOUSAND = 1_000;
const UNPRICED_MODEL = "gemini-unpriced-test";

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

Deno.test("[CostTrackerGoogleFallback] an unpriced Gemini prompt is billed at the input rate", async () => {
  await withTracker(async (tracker) => {
    const cost = await tracker.trackGeneration(ProviderType.GOOGLE, UNPRICED_MODEL, {
      promptTokens: MILLION,
      completionTokens: 0,
      totalTokens: MILLION,
    });
    assertAlmostEquals(cost, (MILLION * COST_RATE_GOOGLE_INPUT) / TOKENS_PER_COST_UNIT);
  });
});

Deno.test("[CostTrackerGoogleFallback] answer and thinking tokens are billed at the output rate", async () => {
  await withTracker(async (tracker) => {
    // Gemini totalTokenCount = prompt + thoughts + candidates, so the output share is total minus prompt.
    const cost = await tracker.trackGeneration(ProviderType.GOOGLE, UNPRICED_MODEL, {
      promptTokens: THOUSAND,
      completionTokens: THOUSAND,
      totalTokens: THOUSAND + MILLION,
    });
    assertAlmostEquals(
      cost,
      (THOUSAND * COST_RATE_GOOGLE_INPUT + MILLION * COST_RATE_GOOGLE) / TOKENS_PER_COST_UNIT,
    );
  });
});
