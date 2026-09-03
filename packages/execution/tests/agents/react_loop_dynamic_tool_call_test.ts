/**
 * @module ReActLoopDynamicToolCallTest
 * @path packages/execution/tests/agents/react_loop_dynamic_tool_call_test.ts
 * @description The ReAct loop must journal each executed tool call as a
 * dynamic_tool_call event (tool + args), the same structured event the flow-based
 * DynamicStepExecutor emits. Trajectory analysis (assert-trajectory) and any tool-call
 * auditing read these events; without them the loop's tool use is invisible even though
 * the tools ran and files changed.
 */

import { assertEquals } from "@std/assert";
import { ReActLoopStrategy } from "@exaix/execution";
import type { IAgentFileBlueprint } from "@exaix/execution";
import type { IModelProvider } from "@exaix/ai/types.ts";
import type { IGenerateResult } from "@exaix/ai/providers";
import { ExecutionStrategyName, SecurityMode, ToolName } from "@exaix/core";
import { REACT_STATUS_COMPLETE, REACT_SUMMARY_PREFIX, REACT_THOUGHT_PREFIX } from "@exaix/core";
import type { IAgentExecutionOptions, IChangesetResult, IExecutionContext } from "@exaix/schemas/agent_orchestrator.ts";
import type { JSONValue } from "@exaix/core/types";

type TestToolParams = Record<string, JSONValue>;
type ReActExecutor = ConstructorParameters<typeof ReActLoopStrategy>[0];

interface CapturedToolCall {
  tool: string;
  args: Record<string, JSONValue>;
}

class ScriptedProvider implements IModelProvider {
  readonly id = "mock-dtc-provider";
  private callCount = 0;
  constructor(private responses: string[]) {}
  async generate(): Promise<IGenerateResult> {
    await Promise.resolve();
    const content = this.responses[this.callCount++] ??
      `${REACT_STATUS_COMPLETE}\n${REACT_SUMMARY_PREFIX}done`;
    return {
      content,
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      model: "mock-model",
      provider: "mock",
      cost_usd: 0,
    };
  }
}

const blueprint = {
  name: "dtc-test-agent",
  model: "mock:test",
  provider: "mock",
  capabilities: [ExecutionStrategyName.REACT],
  systemPrompt: "",
} satisfies IAgentFileBlueprint;

const context = {
  trace_id: "trace-55555555-5555-5555-8555-555555555555",
  request_id: "request-dtc",
  request: "fix the bug",
  plan: "patch utils.ts",
  portal: "todo-app",
} satisfies IExecutionContext;

const options: IAgentExecutionOptions = {
  agent_role: "dtc-test-agent",
  portal: "todo-app",
  security_mode: SecurityMode.HYBRID,
  timeout_ms: 300000,
  max_tool_calls: 100,
  audit_enabled: true,
};

function buildExecutor(captured: CapturedToolCall[]): ReActExecutor {
  return {
    logAgentOutput: async () => {
      await Promise.resolve();
    },
    logDynamicToolCall: async (
      _traceId: string,
      tool: string,
      args: Record<string, JSONValue>,
    ) => {
      captured.push({ tool, args });
      await Promise.resolve();
    },
    validateReviewResult: (res: IChangesetResult): IChangesetResult => res,
    parseAgentResponse: (response: string, ctx: IExecutionContext, startTime: number): IChangesetResult => ({
      branch: `feat/${ctx.portal || "test"}`,
      commit_sha: "0000000000000000000000000000000000000000",
      files_changed: [],
      description: response,
      tool_calls: 0,
      execution_time_ms: Date.now() - startTime,
    }),
    logGeneration: async () => {
      await Promise.resolve();
    },
    toolRegistry: {
      execute: async (_tool: string, _params: TestToolParams) => {
        await Promise.resolve();
        return { success: true, data: "ok" };
      },
      getTools: () => [],
      getBaseDir: () => "/nonexistent-test-basedir",
    },
  } as ReActExecutor;
}

function toolAction(tool: string, path: string): string {
  return `${REACT_THOUGHT_PREFIX}Acting on ${path}.
\`\`\`toml
[[actions]]
tool = "${tool}"
[actions.params]
path = "${path}"
\`\`\`
`;
}

Deno.test("ReActLoop journals a dynamic_tool_call for each executed tool with tool + args", async () => {
  const captured: CapturedToolCall[] = [];
  const provider = new ScriptedProvider([
    toolAction(ToolName.READ_FILE, "src/utils.ts"),
    toolAction(ToolName.PATCH_FILE, "src/utils.ts"),
    `${REACT_STATUS_COMPLETE}\n${REACT_SUMMARY_PREFIX}fixed`,
  ]);
  const strategy = new ReActLoopStrategy(buildExecutor(captured), provider);

  await strategy.execute(blueprint, context, options);

  assertEquals(
    captured.map((c) => c.tool),
    [ToolName.READ_FILE, ToolName.PATCH_FILE],
    "each executed tool must be journaled as a dynamic_tool_call, in order",
  );
  assertEquals(
    captured[1].args.path,
    "src/utils.ts",
    "the tool's args must be journaled so trajectory analysis can inspect them",
  );
});
