/**
 * @module MemoryCostRouterTest
 * @path packages/core/tests/memory_cost_router_test.ts
 * @description Tests for MemoryCostRouter covering tier selection, budget
 * enforcement, cost recording, event emission, and edge cases.
 */
import { assertEquals, assertFalse, assertGreaterOrEqual } from "@std/assert";
import type { ICostTracker } from "../src/types/i_cost_tracker.ts";
import type { IEventLogger } from "../src/logger/event_logger.ts";
import type { ICostFilter, ILogEvent, IProviderCostRecord, LogMetadata } from "@exaix/core/types";
import { MemoryCostRouter } from "../src/cost/memory_cost_router.ts";
import { MemoryCostOperation, MemoryStorageTier } from "../src/types/enums.ts";

/** Implements the full ICostTracker but keeps state in-memory. */
class StubCostTracker implements ICostTracker {
  dailyCost = 0;

  trackGeneration(): Promise<number> {
    return Promise.resolve(0);
  }

  persistEntry(record: IProviderCostRecord): Promise<void> {
    this.dailyCost += record.estimatedCostUsd;
    return Promise.resolve();
  }

  queryByCriteria(_filter: ICostFilter): Promise<IProviderCostRecord[]> {
    return Promise.resolve([]);
  }

  getTotalCost(): number {
    return this.dailyCost;
  }

  getDailyCost(_provider?: string): Promise<number> {
    return Promise.resolve(this.dailyCost);
  }

  flush(): Promise<void> {
    return Promise.resolve();
  }

  isWithinBudget(): Promise<boolean> {
    return Promise.resolve(this.dailyCost < 5.0);
  }
}

/**
 * Stub event logger that captures the last emitted event for assertion.
 */
class StubLogger implements IEventLogger {
  lastAction = "";
  lastPayload: LogMetadata = {};

  log(_event: ILogEvent): Promise<void> {
    return Promise.resolve();
  }

  info(_action: string, _target: string | null, _payload?: LogMetadata, _traceId?: string): Promise<void> {
    this.lastAction = _action;
    if (_payload) this.lastPayload = _payload;
    return Promise.resolve();
  }

  warn(): Promise<void> {
    return Promise.resolve();
  }
  error(): Promise<void> {
    return Promise.resolve();
  }
  fatal(): Promise<void> {
    return Promise.resolve();
  }
  debug(): Promise<void> {
    return Promise.resolve();
  }

  child(): IEventLogger {
    return this;
  }
}

Deno.test("MemoryCostRouter: returns LOCAL when no cost tracker configured", async () => {
  const router = new MemoryCostRouter();
  const allowed = await router.isRemoteAllowed();
  assertFalse(allowed);
  assertEquals(router.selectedTier, MemoryStorageTier.LOCAL);
});

Deno.test("MemoryCostRouter: returns REMOTE when within budget", async () => {
  const tracker = new StubCostTracker();
  const router = new MemoryCostRouter(tracker, undefined, 5.0);
  const allowed = await router.isRemoteAllowed();
  assertEquals(allowed, true);
  assertEquals(router.selectedTier, MemoryStorageTier.REMOTE);
});

Deno.test("MemoryCostRouter: returns LOCAL when budget exhausted", async () => {
  const tracker = new StubCostTracker();
  tracker.dailyCost = 10.0;
  const router = new MemoryCostRouter(tracker, undefined, 5.0);
  const allowed = await router.isRemoteAllowed();
  assertFalse(allowed);
  assertEquals(router.selectedTier, MemoryStorageTier.LOCAL);
});

Deno.test("MemoryCostRouter: recordOperation accumulates daily cost", async () => {
  const tracker = new StubCostTracker();
  const router = new MemoryCostRouter(tracker);

  await router.recordOperation(0.001, MemoryCostOperation.EMBEDDING);
  await router.recordOperation(0.002, MemoryCostOperation.EMBEDDING);

  const status = await router.getBudgetStatus();
  assertGreaterOrEqual(status.dailyCost, 0.0029);
});

Deno.test("MemoryCostRouter: budget status reflects when within budget", async () => {
  const tracker = new StubCostTracker();
  const router = new MemoryCostRouter(tracker, undefined, 5.0);

  const status = await router.getBudgetStatus();
  assertEquals(status.dailyBudget, 5.0);
  assertEquals(status.dailyCost, 0);
  assertEquals(status.withinBudget, true);
});

Deno.test("MemoryCostRouter: budget status reflects when budget exhausted", async () => {
  const tracker = new StubCostTracker();
  tracker.dailyCost = 6.0;
  const router = new MemoryCostRouter(tracker, undefined, 5.0);

  const status = await router.getBudgetStatus();
  assertEquals(status.withinBudget, false);
});

Deno.test("MemoryCostRouter: emits tier_selected event when logger is configured", async () => {
  const tracker = new StubCostTracker();
  const stub = new StubLogger();
  const router = new MemoryCostRouter(tracker, stub, 5.0);

  await router.isRemoteAllowed();

  assertEquals(stub.lastAction, "memory.tier_selected");
  assertEquals(stub.lastPayload.tier, "remote");
  assertEquals(stub.lastPayload.reason, "within_daily_budget");
});

Deno.test("MemoryCostRouter: emits LOCAL tier event when budget exhausted", async () => {
  const tracker = new StubCostTracker();
  tracker.dailyCost = 10.0;
  const stub = new StubLogger();
  const router = new MemoryCostRouter(tracker, stub, 5.0);

  await router.isRemoteAllowed();

  assertEquals(stub.lastAction, "memory.tier_selected");
  assertEquals(stub.lastPayload.tier, "local");
  assertEquals(stub.lastPayload.reason, "daily_budget_exhausted");
});

Deno.test("MemoryCostRouter: no event emitted when no logger configured", async () => {
  const tracker = new StubCostTracker();
  const router = new MemoryCostRouter(tracker);

  await router.isRemoteAllowed();
  assertEquals(router.selectedTier, MemoryStorageTier.REMOTE);
});

Deno.test("MemoryCostRouter: recordOperation no-ops when no cost tracker", async () => {
  const router = new MemoryCostRouter();
  await router.recordOperation(0.001, MemoryCostOperation.EMBEDDING);
  const status = await router.getBudgetStatus();
  assertEquals(status.dailyCost, 0);
});

Deno.test("MemoryCostRouter: recordOperation emits operation and cost metadata", async () => {
  const tracker = new StubCostTracker();
  const logger = new StubLogger();
  const router = new MemoryCostRouter(tracker, logger);

  await router.recordOperation(0.004, MemoryCostOperation.EXTRACTION);

  assertEquals(logger.lastAction, "memory.cost.recorded");
  assertEquals(logger.lastPayload, { costUsd: 0.004, operation: "extraction" });
});
