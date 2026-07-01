/**
 * @module PerModelRateTest
 * @path packages/core/tests/cost/per_model_rate_test.ts
 * @description Phase 132 Step 2 — validates per-model rate override in cost tracking.
 *   `cost_tracking.rates["provider:model"]` takes precedence over bare provider key.
 * @architectural-layer Domain
 * @dependencies [@std/assert, @exaix/core]
 */

import { assertEquals } from "@std/assert";
import { initTestDbService } from "@exaix/testing";
import { CostTracker } from "../../src/cost/cost_tracker.ts";
import { ConfigSchema } from "@exaix/schemas";

Deno.test("[step132.2] per-model rate overrides provider-level rate", async () => {
  const { db, cleanup } = await initTestDbService();
  try {
    const config = ConfigSchema.parse({
      system: { root: "/tmp", log_level: "info" },
      paths: {},
      cost_tracking: {
        rates: {
          "anthropic": 0.005,
          "anthropic:claude-sonnet": 0.01,
        },
      },
    });
    const tracker = new CostTracker(db, config);

    // trackGeneration emits cost tracking — the rate lookup should resolve
    // "provider:model" before falling back to bare provider.
    // With per-model rate 0.01/Mtok and 1000 tokens:
    // cost = 0.01 * (1000 / 1000) = 0.01
    await tracker.trackGeneration(
      "anthropic",
      "claude-sonnet",
      { promptTokens: 500, completionTokens: 500, totalTokens: 1000 },
    );

    // Flush pending records to DB before querying
    await tracker.flush();

    const records = await tracker.queryByCriteria({});
    assertEquals(records.length, 1);
    // Per-model rate 0.01 with 1000 tokens = 0.01 USD
    assertEquals(records[0].estimatedCostUsd, 0.01);
  } finally {
    await cleanup();
  }
});
