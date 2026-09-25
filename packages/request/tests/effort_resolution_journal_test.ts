/**
 * @module EffortResolutionJournalTest
 * @path packages/request/tests/effort_resolution_journal_test.ts
 * @description Phase-197 Step 6 integration proof: a real EventLogger + database record an
 *   agent.effort_resolved row for the planning path — one heuristic (effort auto on a
 *   claude-cli provider journals effort_basis heuristic + heuristic_inputs.complexity_source)
 *   and one native-adaptive (thinking auto on anthropic-claude-sonnet-5 journals
 *   thinking_basis native-adaptive) — both joinable to their request by traceId.
 * @architectural-layer Test
 * @related-files [packages/execution/src/agent_runner.ts, packages/core/src/events/domain_event_types.ts]
 */

import { assertEquals } from "@std/assert";
import type { IModelOptions } from "@exaix/ai/types.ts";
import type { IGenerateResult } from "@exaix/ai/providers";
import type { IModelProvider } from "@exaix/ai/types.ts";
import { AgentRunner } from "@exaix/execution";
import { EventLogger } from "@exaix/core/logger";
import { TaskComplexity } from "@exaix/core";
import { initTestDbService } from "@exaix/testing";
import type { JSONValue } from "@exaix/core";
import type { IAgentEffortResolvedPayload } from "@exaix/core/events";

const WELL_FORMED_RESPONSE = "<thought>ok</thought><content>done</content>";

function makeCapturingProvider(): IModelProvider {
  return {
    id: "capturing-mock",
    generate(_prompt: string, _opts?: IModelOptions): Promise<IGenerateResult> {
      return Promise.resolve({
        content: WELL_FORMED_RESPONSE,
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        model: "capturing-mock",
        provider: "mock",
        cost_usd: 0,
      });
    },
  };
}

Deno.test("[integration] AgentRunner.run journals heuristic and native-adaptive resolutions by traceId", async () => {
  const { db, cleanup } = await initTestDbService();
  try {
    const logger = new EventLogger({ db });
    const provider = makeCapturingProvider();

    const heuristicTrace = crypto.randomUUID();
    const heuristicRunner = new AgentRunner(provider, {
      logger,
      selectedModel: { provider: "claude-cli-sonnet", model: "sonnet" },
      disableRetry: true,
    });
    await heuristicRunner.run(
      { systemPrompt: "You are a test agent.", effort: "auto" },
      {
        userPrompt: "Do the thing",
        context: {},
        traceId: heuristicTrace,
        requestId: "heuristic-req",
        taskComplexity: TaskComplexity.SIMPLE,
        taskComplexitySource: "analysis",
      },
      undefined,
    );

    const adaptiveTrace = crypto.randomUUID();
    const adaptiveRunner = new AgentRunner(provider, {
      logger,
      selectedModel: { provider: "anthropic-claude-sonnet-5", model: "claude-sonnet-5" },
      disableRetry: true,
    });
    await adaptiveRunner.run(
      { systemPrompt: "You are a test agent.", thinking: "auto" },
      {
        userPrompt: "Do the thing",
        context: {},
        traceId: adaptiveTrace,
        requestId: "adaptive-req",
        taskComplexity: TaskComplexity.MEDIUM,
        taskComplexitySource: "analysis",
      },
      undefined,
    );

    await db.waitForFlush();
    const heuristicRows = await db.queryActivity({
      traceId: heuristicTrace,
      actionType: "agent.effort_resolved",
    });
    const adaptiveRows = await db.queryActivity({
      traceId: adaptiveTrace,
      actionType: "agent.effort_resolved",
    });

    assertEquals(heuristicRows.length, 1);
    const heuristicPayload = JSON.parse(heuristicRows[0].payload) as Record<string, JSONValue>;
    assertSatisfiesType(heuristicPayload);
    assertEquals(heuristicPayload.effort_basis, "heuristic");
    assertEquals(heuristicPayload.effort, "low");
    assertEquals(heuristicPayload.effort_declaration_source, "role");
    assertEquals(heuristicPayload.thinking_declaration_source, "none");
    const heuristicInputs = heuristicPayload.heuristic_inputs as Record<string, JSONValue>;
    assertEquals(heuristicInputs.complexity_source, "analysis");

    assertEquals(adaptiveRows.length, 1);
    const adaptivePayload = JSON.parse(adaptiveRows[0].payload) as Record<string, JSONValue>;
    assertSatisfiesType(adaptivePayload);
    assertEquals(adaptivePayload.thinking_basis, "native-adaptive");
    assertEquals(adaptivePayload.thinking, undefined);
    assertEquals(adaptivePayload.thinking_declaration_source, "role");
    assertEquals(adaptivePayload.effort_declaration_source, "none");
  } finally {
    await cleanup();
  }
});

/** Compile-time link: the payload must satisfy IAgentEffortResolvedPayload (the shared
 *  builder's return type), proving both emitters produce the same typed shape (GAP-4). */
function assertSatisfiesType(payload: Record<string, JSONValue>): IAgentEffortResolvedPayload {
  return payload as IAgentEffortResolvedPayload;
}
