/**
 * @module ReActLoopGenerationDurationTest
 * @path packages/execution/tests/agents/react_loop_generation_duration_test.ts
 * @related-files [packages/execution/src/strategies/react_loop_strategy.ts]
 * @architectural-layer Services
 * @description Phase 140a Step 2 — RED-first test. agent.generation_completed carries
 * token counts but no duration at all, for every individual provider.generate() call in
 * a multi-turn ReAct loop. Verifies each generate() call is timed (wrapping the outer
 * withHeartbeat(...) invocation, which already brackets exactly the generate() call with
 * no other side effects between start and end) and logGeneration is called with a real
 * duration_ms per turn.
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
  REACT_THOUGHT_PREFIX,
  SecurityMode,
  ToolName,
} from "@exaix/core";
import type { IAgentExecutionOptions, IChangesetResult, IExecutionContext } from "@exaix/schemas/agent_composer.ts";
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
    agent_role: "test-agent",
    portal,
    security_mode: SecurityMode.SANDBOXED,
    timeout_ms: 300000,
    max_tool_calls: 100,
    audit_enabled: true,
  };
}

Deno.test("[ReActLoopGenerationDuration] each provider.generate() call in a multi-turn loop produces a real duration_ms on logGeneration", async () => {
  const capturedDurations: (number | undefined)[] = [];
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
    logGeneration: async (
      _traceId: string,
      _agentRole: string,
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
      capturedDurations.push(usage.durationMs);
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

  let callCount = 0;
  const provider: IModelProvider = {
    id: "duration-mock-provider",
    async generate(): Promise<IGenerateResult> {
      callCount++;
      await new Promise((resolve) => setTimeout(resolve, 5));
      const content = callCount === 1
        ? `${REACT_THOUGHT_PREFIX}Thinking.\n\`\`\`toml\n[[actions]]\ntool = "write_file"\n[actions.params]\npath = "hello.txt"\ncontent = "world"\n\`\`\`\n`
        : `${REACT_STATUS_COMPLETE}\n${REACT_SUMMARY_PREFIX}Done`;
      return {
        content,
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        model: "mock-model",
        provider: "mock",
        cost_usd: 0.001,
      };
    },
  };

  const strategy = new ReActLoopStrategy(mockExecutor as ReActExecutor, provider);
  await strategy.execute(testBlueprint, testContext, createOptions("test"));

  assertEquals(capturedDurations.length, 2);
  for (const duration of capturedDurations) {
    assertEquals(typeof duration, "number");
    assertEquals(duration! >= 0, true);
  }
});
