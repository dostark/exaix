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
    assertEquals(heuristicPayload.effort_basis, "heuristic");
    assertEquals(heuristicPayload.effort, "low");
    const heuristicInputs = heuristicPayload.heuristic_inputs as Record<string, JSONValue>;
    assertEquals(heuristicInputs.complexity_source, "analysis");

    assertEquals(adaptiveRows.length, 1);
    const adaptivePayload = JSON.parse(adaptiveRows[0].payload) as Record<string, JSONValue>;
    assertEquals(adaptivePayload.thinking_basis, "native-adaptive");
    assertEquals(adaptivePayload.thinking, undefined);
  } finally {
    await cleanup();
  }
});
