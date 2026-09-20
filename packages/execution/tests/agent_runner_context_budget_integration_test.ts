/**
 * @module AgentRunnerContextBudgetIntegrationTest
 * @path packages/execution/tests/agent_runner_context_budget_integration_test.ts
 * @description Proves a real ContextBudgetManager, backed by a real test EventLogger/
 *   DatabaseService and driven through AgentRunner.run(), records real journal rows for
 *   the planning call: (1) context.budget.allocated with a model-derived maxContextTokens
 *   (not Number.MAX_SAFE_INTEGER), and (2) under a tight costTargetTokens cost ceiling,
 *   context.section.truncated on the oversized droppable segment — the first real trigger
 *   of a costTargetTokens-driven compaction outside the ReAct-loop scenario, with a
 *   sibling test confirming droppedSegmentCount stays 0 when the ceiling is unset.
 *   Package-unit proof only — does not by itself establish production reachability (see
 *   VERIFY step 11 / Reachability Ledger).
 * @architectural-layer Test
 * @related-files [
 *   "packages/execution/src/agent_runner.ts",
 *   "packages/execution/src/context/context_budget_manager.ts",
 *   "packages/core/src/prompt_budget_allocator.ts"
 * ]
 */

import { assertEquals, assertGreater, assertNotEquals } from "@std/assert";
import { MockProvider } from "@exaix/ai/providers.ts";
import { AgentRunner, ContextBudgetManager, type IBlueprint, type IParsedRequest } from "@exaix/execution";
import { PORTAL_KNOWLEDGE_KEY, PromptBudgetAllocator } from "@exaix/core";
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

Deno.test("[IAgentRunner] a tight costTargetTokens cost ceiling causes a real, observable compaction (context.section.truncated on the oversized droppable segment)", async () => {
  const { db, cleanup } = await initTestDbService();
  try {
    const logger = new EventLogger({ db });
    const promptBudgetAllocator = new PromptBudgetAllocator({ costTargetTokens: 10_000 });
    const contextBudgetManager = new ContextBudgetManager(undefined, undefined, undefined, logger);

    const runner = new AgentRunner(new MockProvider(WELL_FORMED_RESPONSE), {
      logger,
      contextBudgetManager,
      promptBudgetAllocator,
    });

    const blueprint: IBlueprint = { systemPrompt: "You are a test agent." };
    const traceId = crypto.randomUUID();
    // ~12,500 estimated tokens (chars/4) vastly exceeds the ~2,475-token portalKnowledge
    // section budget under a 10,000-token cost ceiling — 10,000 stays above
    // SECTION_FLOORS.system+plan so this is a real trim, not a floor-clamping error.
    const largePortalKnowledge = "x".repeat(50_000);
    const request: IParsedRequest = {
      userPrompt: "Do the thing.",
      context: { [PORTAL_KNOWLEDGE_KEY]: largePortalKnowledge },
      traceId,
    };

    await runner.run(blueprint, request, undefined);
    await db.waitForFlush();

    const rows = db.getActivitiesByTrace(traceId);
    const truncatedRow = rows.find((r) => r.action_type === DomainEventType.ContextSectionTruncated);

    assertNotEquals(truncatedRow, undefined, "context.section.truncated must be journaled for the oversized segment");
    const payload = JSON.parse(truncatedRow!.payload) as { resultingTokens: number; originalTokens: number };
    assertGreater(payload.originalTokens, payload.resultingTokens);
  } finally {
    await cleanup();
  }
});

Deno.test("[IAgentRunner] leaving costTargetTokens unset reproduces Step 1's exact behavior — no compaction on the same oversized request", async () => {
  const { db, cleanup } = await initTestDbService();
  try {
    const logger = new EventLogger({ db });
    const promptBudgetAllocator = new PromptBudgetAllocator(); // no costTargetTokens
    const contextBudgetManager = new ContextBudgetManager(undefined, undefined, undefined, logger);

    const runner = new AgentRunner(new MockProvider(WELL_FORMED_RESPONSE), {
      logger,
      contextBudgetManager,
      promptBudgetAllocator,
    });

    const blueprint: IBlueprint = { systemPrompt: "You are a test agent." };
    const traceId = crypto.randomUUID();
    const largePortalKnowledge = "x".repeat(50_000);
    const request: IParsedRequest = {
      userPrompt: "Do the thing.",
      context: { [PORTAL_KNOWLEDGE_KEY]: largePortalKnowledge },
      traceId,
    };

    await runner.run(blueprint, request, undefined);
    await db.waitForFlush();

    const rows = db.getActivitiesByTrace(traceId);
    const consumedRow = rows.find((r) => r.action_type === DomainEventType.ContextBudgetConsumed);
    assertNotEquals(consumedRow, undefined);
    const payload = JSON.parse(consumedRow!.payload) as { droppedSegmentCount: number };
    assertEquals(
      payload.droppedSegmentCount,
      0,
      "50KB of portal knowledge fits a real 128K-token model window unconstrained",
    );
  } finally {
    await cleanup();
  }
});
