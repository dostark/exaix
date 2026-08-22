/**
 * @module ReActLoopUsageReasoningTokensE2eTest
 * @path packages/execution/tests/agents/react_loop_usage_reasoning_tokens_e2e_test.ts
 * @related-files [packages/execution/src/strategies/react_loop_strategy.ts]
 * @architectural-layer Services
 * @description Phase 167 Step 12 — RED-first test. IGenerateResult.usage now carries
 * reasoningTokens, but ReActLoopStrategy's accumulator variables and finishLoop's
 * finalResult.usage object literal only read prompt/completion/cache tokens and a predicted
 * cost — reasoning-token data would be silently dropped at this exact leaf-to-trunk assembly
 * point even after IGenerateResult and ChangesetResultSchema are both widened. Verifies a
 * fixture IGenerateResult.usage with reasoningTokens survives the full chain
 * (provider.generate() -> accumulation -> finishLoop) into IChangesetResult.usage, tagged
 * cost_source: "predicted" — mirrors react_loop_usage_cache_tokens_e2e_test.ts's Phase 140a
 * pattern for the same class of bug.
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
  trace_id: "trace-66666666-6666-4666-8666-666666666666",
  request_id: "request-1",
  request: "test",
  plan: "test",
  portal: "test",
} satisfies IExecutionContext;

function createOptions(portal: string): IAgentExecutionOptions {
  return {
    identity_id: "test-agent",
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

Deno.test("[ReActLoopUsageReasoningTokensE2e] reasoning tokens survive provider.generate() -> accumulation -> finishLoop into IChangesetResult.usage, tagged predicted", async () => {
  const provider: IModelProvider = {
    id: "reasoning-token-mock-provider",
    async generate(): Promise<IGenerateResult> {
      await Promise.resolve();
      return {
        content: `${REACT_STATUS_COMPLETE}\n${REACT_SUMMARY_PREFIX}Done`,
        usage: {
          promptTokens: 150,
          completionTokens: 2340,
          totalTokens: 2490,
          reasoningTokens: 2048,
        },
        model: "mock-model",
        provider: "mock",
        cost_usd: 0.005,
      };
    },
  };

  const strategy = new ReActLoopStrategy(mockExecutor as ReActExecutor, provider);
  const result = await strategy.execute(testBlueprint, testContext, createOptions("test"));

  assertEquals(result.usage?.reasoning_tokens, 2048);
  assertEquals(result.usage?.cost_source, "predicted");
  // Existing fields remain correct.
  assertEquals(result.usage?.prompt_tokens, 150);
  assertEquals(result.usage?.completion_tokens, 2340);
});
