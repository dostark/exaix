/**
 * @module ReActLoopUsageCacheTokensE2eTest
 * @path packages/execution/tests/agents/react_loop_usage_cache_tokens_e2e_test.ts
 * @related-files [packages/execution/src/strategies/react_loop_strategy.ts]
 * @architectural-layer Services
 * @description Phase 140a Step 2 — RED-first test. IGenerateResult.usage now carries
 * cacheReadTokens/cacheCreationTokens, but ReActLoopStrategy's accumulator variables and
 * finishLoop's finalResult.usage object literal only read prompt/completion tokens and a
 * predicted cost — cache-token data would be silently dropped at this exact leaf-to-trunk
 * assembly point even after IGenerateResult and ChangesetResultSchema are both widened.
 * Verifies a fixture IGenerateResult.usage with cache tokens survives the full chain
 * (provider.generate() -> accumulation -> finishLoop) into IChangesetResult.usage, tagged
 * cost_source: "predicted" (ReActLoopStrategy's cost_usd is always a calculateCost()
 * estimate, never a reported figure).
 */

import { assertEquals } from "@std/assert";
import { ReActLoopStrategy } from "@exaix/execution";
import type { IAgentFileBlueprint } from "@exaix/execution";
import type { IModelProvider } from "@exaix/ai/types.ts";
import type { IGenerateResult } from "@exaix/ai/providers";
import {
  ExecutionStrategyName,
  REACT_STATUS_COMPLETE,
  REACT_SUMMARY_PREFIX,
  SecurityMode,
  ToolName,
} from "@exaix/core";
import type { IAgentExecutionOptions, IChangesetResult, IExecutionContext } from "@exaix/schemas/agent_orchestrator.ts";
import type { JSONValue } from "@exaix/core/types";

type TestToolParams = Record<string, JSONValue>;
type ReActExecutor = ConstructorParameters<typeof ReActLoopStrategy>[0];

const testBlueprint = {
  name: "test-agent",
  model: "mock:test",
  provider: "mock",
  capabilities: [ExecutionStrategyName.REACT],
  systemPrompt: "",
} satisfies IAgentFileBlueprint;

const testContext = {
  trace_id: "trace-33333333-3333-4333-8333-333333333333",
  request_id: "request-1",
  request: "test",
  plan: "test",
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
  logAgentOutput: async () => {
    await Promise.resolve();
  },
  validateReviewResult: (res: IChangesetResult): IChangesetResult => res,
  parseAgentResponse: (): IChangesetResult => ({
    branch: "feat/test",
    commit_sha: "0000000000000000000000000000000000000000",
    files_changed: [],
    description: "Task completed",
    tool_calls: 0,
    execution_time_ms: 0,
  }),
  logGeneration: async () => {
    await Promise.resolve();
  },
  toolRegistry: {
    execute: async (tool: string, params: TestToolParams) => {
      await Promise.resolve();
      if (tool === ToolName.WRITE_FILE) {
        return { success: true, data: `Wrote ${params.path}` };
      }
      return { success: false, error: "Unknown tool" };
    },
    getTools: () => [],
    getBaseDir: () => "/nonexistent-test-basedir",
  },
};

Deno.test("[ReActLoopUsageCacheTokensE2e] cache tokens survive provider.generate() -> accumulation -> finishLoop into IChangesetResult.usage, tagged predicted", async () => {
  const provider: IModelProvider = {
    id: "cache-token-mock-provider",
    async generate(): Promise<IGenerateResult> {
      await Promise.resolve();
      return {
        content: `${REACT_STATUS_COMPLETE}\n${REACT_SUMMARY_PREFIX}Done`,
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

  const strategy = new ReActLoopStrategy(mockExecutor as ReActExecutor, provider);
  const result = await strategy.execute(testBlueprint, testContext, createOptions("test"));

  assertEquals(result.usage?.cache_read_tokens, 20);
  assertEquals(result.usage?.cache_creation_tokens, 80);
  assertEquals(result.usage?.cost_source, "predicted");
  // Existing fields remain correct.
  assertEquals(result.usage?.prompt_tokens, 100);
  assertEquals(result.usage?.completion_tokens, 50);
});
