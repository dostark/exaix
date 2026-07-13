/**
 * @module HistoryManagerTest
 * @path packages/execution/tests/history_manager_test.ts
 * @description Tests for HistoryManager — loop history compaction and budget checking.
 * @architectural-layer Tests
 */

import { assert, assertEquals } from "@std/assert";
import { HistoryManager } from "../src/history_manager.ts";
import type { ICompactedEntry, ILoopHistoryEntry } from "../src/types.ts";

function mockLogger(): any {
  return { info: () => {}, error: () => {}, log: () => {} };
}

function mockConfig(): any {
  return { execution: {}, budget_enforcement: {}, system: { root: "/tmp" }, paths: { blueprints: "/tmp/blueprints" } };
}

function makeStepEntry(description: string, tokens: number, stepId?: string): ILoopHistoryEntry {
  return {
    type: "step" as const,
    description,
    tokens,
    stepId: stepId ?? `step-${Math.random().toString(36).slice(2, 8)}`,
    filesChanged: [],
    timestamp: Date.now(),
  };
}

Deno.test("HistoryManager.loopHistory returns current entries", () => {
  const manager = new HistoryManager(mockConfig(), mockLogger());
  assertEquals(manager.loopHistory, []);
});

Deno.test("HistoryManager.addEntry appends to history", () => {
  const manager = new HistoryManager(mockConfig(), mockLogger());
  const entry = makeStepEntry("test step", 100);
  manager.addEntry(entry);
  assertEquals(manager.loopHistory.length, 1);
  const entry0 = manager.loopHistory[0];
  if (entry0.type === "step") assertEquals(entry0.description, "test step");
});

Deno.test("HistoryManager.compactLoopHistory does nothing with few entries", async () => {
  const manager = new HistoryManager(mockConfig(), mockLogger());
  manager.addEntry(makeStepEntry("step 1", 50));
  manager.addEntry(makeStepEntry("step 2", 50));
  await manager.compactLoopHistory(5);
  assertEquals(manager.loopHistory.length, 2);
});

Deno.test("HistoryManager.checkBudget triggers compaction when over threshold", async () => {
  const manager = new HistoryManager(mockConfig(), mockLogger());
  for (let i = 0; i < 10; i++) {
    manager.addEntry(makeStepEntry(`step ${i}`, 200));
  }
  const budget = { sections: { loopHistory: 100 } } as any;
  await manager.checkBudget(budget);
  assert(manager.loopHistory.length < 10);
});

Deno.test("HistoryManager.checkBudget does nothing when under threshold", async () => {
  const manager = new HistoryManager(mockConfig(), mockLogger());
  manager.addEntry(makeStepEntry("one step", 10));
  const budget = { sections: { loopHistory: 1000 } } as any;
  await manager.checkBudget(budget);
  assertEquals(manager.loopHistory.length, 1);
});

Deno.test("HistoryManager.getBudgetUsage returns accurate token count", () => {
  const manager = new HistoryManager(mockConfig(), mockLogger());
  manager.addEntry(makeStepEntry("step 1", 50));
  manager.addEntry(makeStepEntry("step 2", 150));
  assertEquals(manager.getBudgetUsage(), 200);
});
