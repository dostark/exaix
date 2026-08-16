/**
 * @module HistoryManagerTest
 * @path packages/execution/tests/history_manager_test.ts
 * @description Tests for HistoryManager — loop history compaction and budget checking.
 * @architectural-layer Tests
 */

import { assert, assertEquals } from "@std/assert";
import { DomainEventType } from "@exaix/core/events";
import type { LogMetadata } from "@exaix/core";
import { HistoryManager } from "../src/history_manager.ts";
import type { ILoopHistoryEntry } from "../src/types.ts";
import type { Config } from "@exaix/schemas/config.ts";

import type { IEventLogger } from "@exaix/core/logger";

function mockLogger(): IEventLogger {
  return {
    info: async () => {},
    error: async () => {},
    log: async () => {},
    warn: async () => {},
    fatal: async () => {},
    debug: async () => {},
    child: () => mockLogger(),
  };
}

function createTrackingLogger(): IEventLogger & { calls: Array<[string, string | null, LogMetadata?]> } {
  const calls: Array<[string, string | null, LogMetadata?]> = [];
  const logger: IEventLogger & { calls: typeof calls } = {
    calls,
    log: () => Promise.resolve(),
    info: (action, target, payload) => {
      calls.push([action, target, payload]);
      return Promise.resolve();
    },
    warn: () => Promise.resolve(),
    error: () => Promise.resolve(),
    fatal: () => Promise.resolve(),
    debug: () => Promise.resolve(),
    child: () => createTrackingLogger(),
  };
  return logger;
}

function mockConfig(): Config {
  return {
    execution: {},
    budget_enforcement: {},
    system: { root: "/tmp" },
    paths: { blueprints: "/tmp/blueprints" },
  } as Config;
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

Deno.test("HistoryManager.addEntry emits LoopHistoryEntryAdded with entry_type and tokens", () => {
  const logger = createTrackingLogger();
  const manager = new HistoryManager(mockConfig(), logger);
  const entry = makeStepEntry("test step", 150, "step-42");
  manager.addEntry(entry);
  assertEquals(logger.calls.length, 1);
  const [action, target, payload] = logger.calls[0];
  assertEquals(action, DomainEventType.LoopHistoryEntryAdded);
  assertEquals(target, "step-42");
  assertEquals(payload, { entry_type: "step", tokens: 150 });
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
  const budget = {
    model: "",
    totalBudgetTokens: 0,
    safetyBufferTokens: 0,
    sections: { system: 0, plan: 0, portalKnowledge: 0, memory: 0, skills: 0, loopHistory: 100 },
  };
  await manager.checkBudget(budget);
  assert(manager.loopHistory.length < 10);
});

Deno.test("HistoryManager.checkBudget does nothing when under threshold", async () => {
  const manager = new HistoryManager(mockConfig(), mockLogger());
  manager.addEntry(makeStepEntry("one step", 10));
  const budget = {
    model: "",
    totalBudgetTokens: 0,
    safetyBufferTokens: 0,
    sections: { system: 0, plan: 0, portalKnowledge: 0, memory: 0, skills: 0, loopHistory: 1000 },
  };
  await manager.checkBudget(budget);
  assertEquals(manager.loopHistory.length, 1);
});

Deno.test("HistoryManager.getBudgetUsage returns accurate token count", () => {
  const manager = new HistoryManager(mockConfig(), mockLogger());
  manager.addEntry(makeStepEntry("step 1", 50));
  manager.addEntry(makeStepEntry("step 2", 150));
  assertEquals(manager.getBudgetUsage(), 200);
});
