/**
 * @module AgentExecutorBudgetWiringTest
 * @path packages/execution/tests/agent_executor_budget_wiring_test.ts
 * @description Tests for Step 6: AgentExecutor constructor injection of
 * contextBudgetManager and snapshotStore. Verifies these parameters are
 * accepted and properly assigned to instance fields.
 * @architectural-layer Tests
 * @related-files [
 *   "packages/execution/src/agent_executor.ts",
 *   "packages/execution/src/context/context_budget_manager.ts",
 *   "packages/execution/src/context/snapshot_store.ts"
 * ]
 */

import { assertEquals, assertExists } from "@std/assert";
import type { IContextBudgetManager } from "@exaix/execution";
import type { ISnapshotStore } from "@exaix/execution";
import { AgentExecutor } from "@exaix/execution";
import { castAny } from "@exaix/testing";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeMockBudgetManager(): IContextBudgetManager {
  return {
    prepare: () =>
      Promise.resolve({
        segments: [],
        snapshot: {
          stepId: "test-step",
          traceId: "test-trace",
          model: "test-model",
          decisions: [],
          usedInputTokens: 0,
          usedOutputTokens: 0,
          maxContextTokens: 0,
          overflowRecovered: false,
          createdAt: new Date().toISOString(),
        },
      }),
  };
}

function makeMockSnapshotStore(): ISnapshotStore {
  return {
    save: () => Promise.resolve(),
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

Deno.test("[AgentExecutor] constructor accepts contextBudgetManager parameter", () => {
  const budgetManager = makeMockBudgetManager();
  const executor = new AgentExecutor({
    config: castAny({}),
    db: castAny({}),
    logger: castAny({}),
    pathResolver: castAny({}),
    permissions: castAny({}),
    contextBudgetManager: budgetManager,
  });

  assertEquals(executor.contextBudgetManager, budgetManager);
});

Deno.test("[AgentExecutor] constructor accepts snapshotStore parameter", () => {
  const snapshotStore = makeMockSnapshotStore();
  const executor = new AgentExecutor({
    config: castAny({}),
    db: castAny({}),
    logger: castAny({}),
    pathResolver: castAny({}),
    permissions: castAny({}),
    snapshotStore,
  });

  assertEquals(executor.snapshotStore, snapshotStore);
});

Deno.test("[AgentExecutor] both contextBudgetManager and snapshotStore can be passed together", () => {
  const budgetManager = makeMockBudgetManager();
  const snapshotStore = makeMockSnapshotStore();
  const executor = new AgentExecutor({
    config: castAny({}),
    db: castAny({}),
    logger: castAny({}),
    pathResolver: castAny({}),
    permissions: castAny({}),
    contextBudgetManager: budgetManager,
    snapshotStore,
  });

  assertExists(executor.contextBudgetManager);
  assertExists(executor.snapshotStore);
  assertEquals(executor.contextBudgetManager, budgetManager);
  assertEquals(executor.snapshotStore, snapshotStore);
});
