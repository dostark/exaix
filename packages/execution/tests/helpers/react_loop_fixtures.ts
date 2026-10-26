/**
 * @module ReActLoopTestFixtures
 * @path packages/execution/tests/helpers/react_loop_fixtures.ts
 * @description Blueprint, context, options, and executor doubles shared by the ReAct loop strategy tests.
 * @architectural-layer Test
 * @related-files [packages/execution/tests/agents/react_loop_strategy_test.ts, packages/execution/tests/agents/react_loop_usage_cache_tokens_e2e_test.ts]
 */

import type { ReActLoopStrategy } from "@exaix/execution";
import type { IAgentFileBlueprint } from "@exaix/execution";
import { ExecutionStrategyName, SecurityMode, ToolName } from "@exaix/core";
import type { IAgentExecutionOptions, IChangesetResult, IExecutionContext } from "@exaix/schemas/agent_composer.ts";
import type { JSONValue } from "@exaix/core/types";

export type TestToolParams = Record<string, JSONValue>;

export type ReActExecutor = ConstructorParameters<typeof ReActLoopStrategy>[0];

export const testBlueprint = {
  name: "test-agent",
  model: "mock:test",
  provider: "mock",
  capabilities: [ExecutionStrategyName.REACT],
  systemPrompt: "",
} satisfies IAgentFileBlueprint;

export const testContext = {
  trace_id: "trace-33333333-3333-4333-8333-333333333333",
  request_id: "request-1",
  request: "test",
  plan: "test",
  portal: "test",
} satisfies IExecutionContext;

export function createOptions(portal: string): IAgentExecutionOptions {
  return {
    agent_role: "test-agent",
    portal,
    security_mode: SecurityMode.SANDBOXED,
    timeout_ms: 300000,
    max_tool_calls: 100,
    audit_enabled: true,
  };
}

export const mockExecutor = {
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
