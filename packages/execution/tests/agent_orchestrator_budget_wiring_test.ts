/**
 * @module AgentExecutorBudgetWiringTest
 * @path packages/execution/tests/agent_orchestrator_budget_wiring_test.ts
 * @description Tests for Step 6: AgentComposer constructor injection of
 * contextBudgetManager and snapshotStore. Verifies these parameters are
 * accepted and properly assigned to instance fields.
 * @architectural-layer Tests
 * @related-files [
 *   "packages/execution/src/agent_composer.ts",
 *   "packages/execution/src/context/context_budget_manager.ts",
 *   "packages/execution/src/context/snapshot_store.ts"
 * ]
 */

import { assertEquals, assertExists } from "@std/assert";
import type { IContextBudgetManager } from "@exaix/execution";
import type { ISnapshotStore } from "@exaix/execution";
import { AgentComposer, ExecutionContextService } from "@exaix/execution";
import { castAny } from "@exaix/testing";

// Helpers

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

// Tests

Deno.test("[AgentComposer] default production composition provides contextBudgetManager", () => {
  const executor = new AgentComposer({
    config: castAny({}),
    db: castAny({}),
    logger: castAny({}),
    pathResolver: castAny({}),
    permissions: castAny({}),
  });

  assertExists(executor.contextBudgetManager);
});
Deno.test("[AgentComposer] constructor accepts contextBudgetManager parameter", () => {
  const budgetManager = makeMockBudgetManager();
  const executor = new AgentComposer({
    config: castAny({}),
    db: castAny({}),
    logger: castAny({}),
    pathResolver: castAny({}),
    permissions: castAny({}),
    executionContext: new ExecutionContextService(castAny({}), castAny({}), {
      contextBudgetManager: budgetManager,
    }),
  });

  assertEquals(executor.contextBudgetManager, budgetManager);
});

Deno.test("[AgentComposer] constructor accepts snapshotStore parameter", () => {
  const snapshotStore = makeMockSnapshotStore();
  const executor = new AgentComposer({
    config: castAny({}),
    db: castAny({}),
    logger: castAny({}),
    pathResolver: castAny({}),
    permissions: castAny({}),
    executionContext: new ExecutionContextService(castAny({}), castAny({}), {
      snapshotStore,
    }),
  });

  assertEquals(executor.snapshotStore, snapshotStore);
});

Deno.test("[AgentComposer] both contextBudgetManager and snapshotStore can be passed together", () => {
  const budgetManager = makeMockBudgetManager();
  const snapshotStore = makeMockSnapshotStore();
  const executor = new AgentComposer({
    config: castAny({}),
    db: castAny({}),
    logger: castAny({}),
    pathResolver: castAny({}),
    permissions: castAny({}),
    executionContext: new ExecutionContextService(castAny({}), castAny({}), {
      contextBudgetManager: budgetManager,
      snapshotStore,
    }),
  });

  assertExists(executor.contextBudgetManager);
  assertExists(executor.snapshotStore);
  assertEquals(executor.contextBudgetManager, budgetManager);
  assertEquals(executor.snapshotStore, snapshotStore);
});
