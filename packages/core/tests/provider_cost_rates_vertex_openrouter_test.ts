/**
 * @module ProviderCostRatesVertexOpenRouterTest
 * @path packages/core/tests/provider_cost_rates_vertex_openrouter_test.ts
 * @related-files ["packages/core/src/types/enums.ts", "packages/core/src/types/constants.ts", "packages/core/src/cost/cost_tracker.ts"]
 * @architectural-layer Core
 * @description Validates Phase 80 Step 1 — the new Vertex AI and OpenRouter provider
 * identities (enum members, PROVIDER_* aliases, COST_RATE_* constants) and their wiring
 * into the CostTracker rate map. OpenRouter uses an unmetered (0) sentinel because its
 * price varies per underlying sub-model.
 */

import { assertAlmostEquals, assertEquals } from "@std/assert";
import { CostTracker } from "@exaix/core/cost";
import { initTestDbService } from "@exaix/testing";
import {
  COST_RATE_GOOGLE,
  COST_RATE_OPENROUTER,
  COST_RATE_VERTEX,
  PROVIDER_OPENROUTER,
  PROVIDER_VERTEX,
  ProviderType,
  TOKENS_PER_COST_UNIT,
} from "@exaix/core";

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

Deno.test("ProviderType includes VERTEX and OPENROUTER members", () => {
  assertEquals(ProviderType.VERTEX, "vertex-ai");
  assertEquals(ProviderType.OPENROUTER, "openrouter");
});

Deno.test("PROVIDER_* constants alias the new enum members", () => {
  assertEquals(PROVIDER_VERTEX, ProviderType.VERTEX);
  assertEquals(PROVIDER_OPENROUTER, ProviderType.OPENROUTER);
});

Deno.test("COST_RATE_VERTEX matches the Google rate; OpenRouter is an unmetered sentinel", () => {
  assertEquals(COST_RATE_VERTEX, COST_RATE_GOOGLE);
  assertEquals(COST_RATE_OPENROUTER, 0);
});

Deno.test("CostTracker estimates Vertex cost using COST_RATE_VERTEX", async () => {
  await withTracker(async (tracker) => {
    const cost = await tracker.trackGeneration(PROVIDER_VERTEX, "gemini-2.5-flash", {
      promptTokens: 400,
      completionTokens: 600,
      totalTokens: 1000,
    });
    assertAlmostEquals(cost, 1000 * (COST_RATE_VERTEX / TOKENS_PER_COST_UNIT));
  });
});

Deno.test("CostTracker treats OpenRouter as unmetered (cost 0)", async () => {
  await withTracker(async (tracker) => {
    const cost = await tracker.trackGeneration(PROVIDER_OPENROUTER, "anthropic/claude-3-opus", {
      promptTokens: 1000,
      completionTokens: 1000,
      totalTokens: 2000,
    });
    assertEquals(cost, 0);
  });
});

Deno.test("CostTracker yields a finite, non-negative cost for every ProviderType", async () => {
  await withTracker(async (tracker) => {
    for (const provider of Object.values(ProviderType)) {
      const cost = await tracker.trackGeneration(provider, "model", {
        promptTokens: 50,
        completionTokens: 50,
        totalTokens: 100,
      });
      assertEquals(Number.isFinite(cost), true, `cost for ${provider} must be finite`);
      assertEquals(cost >= 0, true, `cost for ${provider} must be >= 0`);
    }
  });
});
