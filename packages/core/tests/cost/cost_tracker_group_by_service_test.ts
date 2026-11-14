/**
 * @module CostTrackerGroupByServiceTest
 * @path packages/core/tests/cost/cost_tracker_group_by_service_test.ts
 * @description Verifies grouping of persisted costs by service and the per-source cost split of each group.
 * @architectural-layer Core
 * @dependencies [@std/assert, @exaix/core/cost, @exaix/testing]
 * @related-files [packages/core/src/cost/cost_tracker.ts, packages/core/src/types/database.ts]
 */

import { assertAlmostEquals, assertEquals } from "@std/assert";
import { CostTracker } from "@exaix/core/cost";
import { COST_SOURCE_ESTIMATE, CostGroupBy, type IDatabaseService } from "@exaix/core/types";
import { initTestDbService } from "@exaix/testing";

type CostRecord = Awaited<ReturnType<CostTracker["queryByCriteria"]>>[number];
const UNKNOWN_GROUP = "(unknown)";
const TOKENS = { promptTokens: 10, completionTokens: 5, totalTokens: 15 };

async function trackReported(tracker: CostTracker, model: string, costUsd: number, service?: string) {
  await tracker.trackGeneration(
    "p",
    model,
    { ...TOKENS, costUsd },
    "trace",
    "portal",
    service ? { service } : undefined,
  );
}

Deno.test("queryGroupedByCriteria groups by service and by source", async () => {
  const { db, cleanup } = await initTestDbService();
  try {
    const tracker = new CostTracker(db);
    await trackReported(tracker, "m1", 0.25, "svc-a");
    await trackReported(tracker, "m2", 0.75, "svc-a");
    await trackReported(tracker, "m3", 1, "svc-b");
    await tracker.flush();

    const groups = await tracker.queryGroupedByCriteria({}, CostGroupBy.SERVICE);

    assertEquals(groups.map((group) => group.group), ["svc-a", "svc-b"]);
    assertEquals(groups[0].calls, 2);
    assertAlmostEquals(groups[0].estimatedCostUsd ?? 0, 1);
    assertAlmostEquals(groups[0].costBySource.provider_reported, 1);
    assertEquals(groups[0].costBySource.registry_computed, 0);
    assertEquals(groups[0].costBySource[COST_SOURCE_ESTIMATE], 0);
    assertAlmostEquals(groups[1].costBySource.provider_reported, 1);
  } finally {
    await cleanup();
  }
});

Deno.test("a record without a service groups under (unknown)", async () => {
  const { db, cleanup } = await initTestDbService();
  try {
    const tracker = new CostTracker(db);
    await trackReported(tracker, "legacy", 0.5);
    await tracker.flush();

    const groups = await tracker.queryGroupedByCriteria({}, CostGroupBy.SERVICE);

    assertEquals(groups.map((group) => group.group), [UNKNOWN_GROUP]);
  } finally {
    await cleanup();
  }
});

Deno.test("a record with no stored source counts as estimated", async () => {
  const { db, cleanup } = await initTestDbService();
  try {
    const tracker = new CostTracker(db);
    await tracker.trackGeneration("anthropic", "blended", TOKENS, "trace", "portal", { service: "svc-a" });
    await tracker.flush();

    const [group] = await tracker.queryGroupedByCriteria({}, CostGroupBy.SERVICE);

    assertEquals(group.costBySource.provider_reported, 0);
    assertEquals(group.costBySource.registry_computed, 0);
    assertEquals(group.costBySource[COST_SOURCE_ESTIMATE] > 0, true);
  } finally {
    await cleanup();
  }
});

/** A tracker whose stored records are fixed, so a record with no cost can be tested. */
class FixedRecordsTracker extends CostTracker {
  constructor(db: IDatabaseService, private readonly records: CostRecord[]) {
    super(db);
  }

  override queryByCriteria(): Promise<CostRecord[]> {
    return Promise.resolve(this.records);
  }
}

function costRecord(overrides: Partial<CostRecord>): CostRecord {
  return {
    id: crypto.randomUUID(),
    provider: "p",
    model: "m",
    requests: 1,
    tokens: 15,
    promptTokens: 10,
    completionTokens: 5,
    estimatedCostUsd: 0,
    timestamp: new Date(),
    ...overrides,
  };
}

Deno.test("a null-cost record counts as unpriced and is excluded from the sources", async () => {
  const { db, cleanup } = await initTestDbService();
  try {
    const tracker = new FixedRecordsTracker(db, [
      costRecord({ service: "svc-a", estimatedCostUsd: 0.5, costSource: "provider_reported" }),
      costRecord({ service: "svc-a", estimatedCostUsd: null }),
    ]);

    const [group] = await tracker.queryGroupedByCriteria({}, CostGroupBy.SERVICE);

    assertEquals(group.unpricedCalls, 1);
    assertEquals(group.estimatedCostUsd, null);
    assertAlmostEquals(group.costBySource.provider_reported, 0.5);
  } finally {
    await cleanup();
  }
});

Deno.test("queryGroupedByCriteria still groups by model and portal", async () => {
  const { db, cleanup } = await initTestDbService();
  try {
    const tracker = new CostTracker(db);
    await trackReported(tracker, "m1", 0.25, "svc-a");
    await tracker.flush();

    assertEquals((await tracker.queryGroupedByCriteria({}, CostGroupBy.MODEL)).map((group) => group.group), ["m1"]);
    assertEquals((await tracker.queryGroupedByCriteria({}, CostGroupBy.PORTAL)).map((group) => group.group), [
      "portal",
    ]);
  } finally {
    await cleanup();
  }
});
