/**
 * @module LegacyStrategyGenerationDurationTest
 * @path packages/execution/tests/legacy_strategy_generation_duration_test.ts
 * @related-files [packages/execution/src/strategies/legacy_strategy.ts, packages/execution/src/agent_orchestrator.ts]
 * @architectural-layer Services
 * @description Phase 140a Step 2 — RED-first test. agent.generation_completed carries
 * token counts but no duration at all. LegacyAgentStrategy has exactly one
 * provider.generate() call per execution, so timing it is a single wrap-point, not a
 * loop — but it must not be skipped just because ReActLoopStrategy is the more commonly
 * exercised path. Verifies LegacyAgentStrategy's single generate() call is timed and
 * produces a duration_ms on the logGeneration call, proven independently of
 * ReActLoopStrategy's own timing test.
 */

import { assertEquals } from "@std/assert";
import { LegacyAgentStrategy } from "@exaix/execution";
import type { AgentOrchestrator, IAgentFileBlueprint } from "@exaix/execution";
import type { IModelProvider } from "@exaix/ai/types.ts";
import type { IGenerateResult } from "@exaix/ai/providers";
import { ExecutionStrategyName, SecurityMode } from "@exaix/core";
import type { IAgentExecutionOptions, IChangesetResult, IExecutionContext } from "@exaix/schemas/agent_orchestrator.ts";

const testBlueprint = {
  name: "test-agent",
  model: "mock:test",
  provider: "mock",
  capabilities: [ExecutionStrategyName.MCP],
  systemPrompt: "",
} satisfies IAgentFileBlueprint;

const testContext = {
  trace_id: "trace-55555555-5555-4555-8555-555555555555",
  request_id: "request-1",
  request: "test",
  plan: "test plan",
  portal: "test",
} satisfies IExecutionContext;

function createOptions(portal: string): IAgentExecutionOptions {
  return {
    agent_role: "test-agent",
    portal,
    security_mode: SecurityMode.SANDBOXED,
    timeout_ms: 300000,
    max_tool_calls: 100,
    audit_enabled: true,
  };
}

Deno.test("[LegacyStrategyGenerationDuration] logGeneration is called with a real, non-negative duration_ms for the single generate() call", async () => {
  let capturedDurationMs: number | undefined;
  const mockExecutor = {
    buildExecutionPrompt: async () => {
      await Promise.resolve();
      return "test prompt";
    },
    logGeneration: async (
      _traceId: string,
      _identityId: string,
      _model: string,
      _provider: string,
      usage: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
        costUsd: number;
        durationMs?: number;
      },
    ) => {
      await Promise.resolve();
      capturedDurationMs = usage.durationMs;
    },
    parseAgentResponse: (
      _response: string,
      context: IExecutionContext,
      startTime: number,
    ): IChangesetResult => ({
      branch: `feat/${context.portal}`,
      commit_sha: "0000000000000000000000000000000000000000",
      files_changed: [],
      description: context.plan,
      tool_calls: 0,
      execution_time_ms: Date.now() - startTime,
    }),
    validateReviewResult: (res: IChangesetResult): IChangesetResult => res,
    toolRegistry: {
      execute: async () => {
        await Promise.resolve();
        return { success: true };
      },
      getTools: () => [],
      getBaseDir: () => "/nonexistent-test-basedir",
    },
    getPortalConfig: () => undefined,
  };

  const provider: IModelProvider = {
    id: "duration-mock-provider",
    async generate(): Promise<IGenerateResult> {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return {
        content: "no TOML actions here",
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        model: "mock-model",
        provider: "mock",
        cost_usd: 0.001,
      };
    },
  };

  const strategy = new LegacyAgentStrategy(mockExecutor as Partial<AgentOrchestrator> as AgentOrchestrator, provider);
  await strategy.execute(testBlueprint, testContext, createOptions("test"));

  assertEquals(typeof capturedDurationMs, "number");
  assertEquals(capturedDurationMs! >= 0, true);
});
