/**
 * @module AgentRunnerContextBudgetIntegrationTest
 * @path packages/execution/tests/agent_runner_context_budget_integration_test.ts
 * @description Phase 196 Step 1 — proves a real ContextBudgetManager, backed by a real
 *   test EventLogger/DatabaseService and driven through AgentRunner.run(), records a real
 *   context.budget.allocated journal row for the planning call with a model-derived
 *   maxContextTokens (not Number.MAX_SAFE_INTEGER). Package-unit proof only — does not by
 *   itself establish production reachability (see VERIFY step 11 / Reachability Ledger).
 * @architectural-layer Test
 * @related-files [
 *   "packages/execution/src/agent_runner.ts",
 *   "packages/execution/src/context/context_budget_manager.ts",
 *   "packages/core/src/prompt_budget_allocator.ts"
 * ]
 */

import { assertEquals, assertNotEquals } from "@std/assert";
import { MockProvider } from "@exaix/ai/providers.ts";
import { AgentRunner, ContextBudgetManager, type IBlueprint, type IParsedRequest } from "@exaix/execution";
import { PromptBudgetAllocator } from "@exaix/core";
import { DomainEventType } from "@exaix/core/events";
import { EventLogger } from "@exaix/core/logger";
import { initTestDbService } from "@exaix/testing";

const WELL_FORMED_RESPONSE = "<thought>ok</thought><content>done</content>";

Deno.test("[IAgentRunner] a real ContextBudgetManager/PromptBudgetAllocator, driven through run(), records a real context.budget.allocated journal row", async () => {
  const { db, cleanup } = await initTestDbService();
  try {
    const logger = new EventLogger({ db });
    const tokenizer = undefined; // exercises the chars/4 fallback branch alongside a real allocator
    const promptBudgetAllocator = new PromptBudgetAllocator();
    const contextBudgetManager = new ContextBudgetManager(tokenizer, undefined, undefined, logger);

    const runner = new AgentRunner(new MockProvider(WELL_FORMED_RESPONSE), {
      logger,
      contextBudgetManager,
      promptBudgetAllocator,
    });

    const blueprint: IBlueprint = { systemPrompt: "You are a test agent." };
    const traceId = crypto.randomUUID();
    const request: IParsedRequest = { userPrompt: "Do the thing.", context: {}, traceId };

    await runner.run(blueprint, request, undefined);
    await db.waitForFlush();

    const rows = db.getActivitiesByTrace(traceId);
    const allocatedRow = rows.find((r) => r.action_type === DomainEventType.ContextBudgetAllocated);

    assertNotEquals(allocatedRow, undefined, "context.budget.allocated must be journaled for the planning call");
    const payload = JSON.parse(allocatedRow!.payload) as { maxContextTokens: number };
    assertNotEquals(payload.maxContextTokens, Number.MAX_SAFE_INTEGER);
    assertEquals(typeof payload.maxContextTokens, "number");
  } finally {
    await cleanup();
  }
});
