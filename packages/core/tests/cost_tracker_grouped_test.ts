/**
 * @module CostTrackerGroupedTest
 * @path packages/core/tests/cost_tracker_grouped_test.ts
 * @description Verifies grouped totals against persisted provider costs.
 * @architectural-layer Core
 * @related-files [packages/core/src/cost/cost_tracker.ts]
 */

import { assertAlmostEquals, assertEquals } from "@std/assert";
import { CostTracker } from "@exaix/core/cost";
import { CostGroupBy } from "@exaix/core/types";
import { initTestDbService } from "@exaix/testing";

Deno.test("CostTracker groups persisted model costs and cache tokens", async () => {
  const { db, cleanup } = await initTestDbService();
  try {
    const tracker = new CostTracker(db);
    await tracker.trackGeneration(
      "anthropic",
      "sonnet",
      {
        promptTokens: 10,
        completionTokens: 3,
        totalTokens: 13,
        costUsd: 0.1,
        cacheReadTokens: 7,
        cacheCreationTokens: 2,
      },
      "trace-1",
      "portal-a",
    );
    await tracker.trackGeneration(
      "anthropic",
      "sonnet",
      {
        promptTokens: 20,
        completionTokens: 4,
        totalTokens: 24,
        costUsd: 0.2,
        cacheReadTokens: 8,
      },
      "trace-2",
      "portal-a",
    );
    await tracker.trackGeneration(
      "openai",
      "gpt",
      {
        promptTokens: 5,
        completionTokens: 1,
        totalTokens: 6,
        costUsd: 0.05,
      },
      "trace-3",
      "portal-b",
    );
    await tracker.flush();

    const groups = await tracker.queryGroupedByCriteria({}, CostGroupBy.MODEL);
    assertEquals(groups, [
      {
        group: "gpt",
        calls: 1,
        promptTokens: 5,
        completionTokens: 1,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        estimatedCostUsd: 0.05,
      },
      {
        group: "sonnet",
        calls: 2,
        promptTokens: 30,
        completionTokens: 7,
        cacheReadTokens: 15,
        cacheCreationTokens: 2,
        estimatedCostUsd: 0.1 + 0.2,
      },
    ]);
    const portalGroups = await tracker.queryGroupedByCriteria({ portal: "portal-a" }, CostGroupBy.PORTAL);
    assertEquals(portalGroups.length, 1);
    assertEquals(portalGroups[0].calls, 2);
    assertEquals(portalGroups[0].group, "portal-a");
    assertAlmostEquals(groups[1].estimatedCostUsd, 0.3);
  } finally {
    await cleanup();
  }
});
