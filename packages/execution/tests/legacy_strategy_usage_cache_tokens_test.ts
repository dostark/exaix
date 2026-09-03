/**
 * @module LegacyStrategyUsageCacheTokensTest
 * @path packages/execution/tests/legacy_strategy_usage_cache_tokens_test.ts
 * @related-files [packages/execution/src/strategies/legacy_strategy.ts]
 * @architectural-layer Services
 * @description Phase 140a Step 2 — RED-first test. LegacyAgentStrategy.execute's
 * parsedResult.usage object literal only reads prompt/completion tokens and a predicted
 * cost from the widened IGenerateResult — cache-token data would be silently dropped at
 * this leaf-to-trunk assembly point even after IGenerateResult and ChangesetResultSchema
 * are both widened. Verifies a fixture IGenerateResult.usage with cache tokens, run
 * through LegacyAgentStrategy.execute, produces an IChangesetResult.usage with matching
 * cache-token values and cost_source: "predicted" (LegacyAgentStrategy's cost_usd is
 * always a calculateCost() estimate, never a reported figure) — proven independently of
 * the ReActLoopStrategy test, since a shared-helper bug that only one call site exercises
 * must be caught here too.
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
  trace_id: "trace-44444444-4444-4444-8444-444444444444",
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

const mockExecutor = {
  buildExecutionPrompt: async () => {
    await Promise.resolve();
    return "test prompt";
  },
  logGeneration: async () => {
    await Promise.resolve();
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

Deno.test("[LegacyStrategyUsageCacheTokens] cache tokens survive provider.generate() into IChangesetResult.usage, tagged predicted", async () => {
  const provider: IModelProvider = {
    id: "cache-token-mock-provider",
    async generate(): Promise<IGenerateResult> {
      await Promise.resolve();
      return {
        content: "no TOML actions here",
        usage: {
          promptTokens: 100,
          completionTokens: 50,
          totalTokens: 150,
          cacheReadTokens: 20,
          cacheCreationTokens: 80,
        },
        model: "mock-model",
        provider: "mock",
        cost_usd: 0.005,
      };
    },
  };

  const strategy = new LegacyAgentStrategy(mockExecutor as Partial<AgentOrchestrator> as AgentOrchestrator, provider);
  const result = await strategy.execute(testBlueprint, testContext, createOptions("test"));

  assertEquals(result.usage?.cache_read_tokens, 20);
  assertEquals(result.usage?.cache_creation_tokens, 80);
  assertEquals(result.usage?.cost_source, "predicted");
  // Existing fields remain correct.
  assertEquals(result.usage?.prompt_tokens, 100);
  assertEquals(result.usage?.completion_tokens, 50);
});
