/**
 * @module ReActLoopPortalGraphPermissionsTest
 * @path packages/execution/tests/agents/react_loop_portal_graph_permissions_test.ts
 * @description Phase 198 Step 4 — an unlisted ReAct role must not see (native tool
 * definitions / ACI prompt text) or execute (ToolRegistry.execute) query_symbols /
 * get_module_dependencies; a role that lists them in permitted_tools can call them. Before
 * this step, permitted_tools only gated prompt/ACI visibility — ReActLoopStrategy.executeTool
 * never rejected a model-supplied call to an unlisted tool name.
 * @architectural-layer Test
 * @related-files [packages/execution/src/strategies/react_loop_strategy.ts, packages/tool-runtime/src/tool_registry.ts]
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

type ReActExecutor = ConstructorParameters<typeof ReActLoopStrategy>[0];

class ScriptedProvider implements IModelProvider {
  readonly id = "mock-permissions-provider";
  private callCount = 0;
  constructor(private responses: string[]) {}
  async generate(): Promise<IGenerateResult> {
    await Promise.resolve();
    const content = this.responses[this.callCount++] ?? `${REACT_STATUS_COMPLETE}\n${REACT_SUMMARY_PREFIX}done`;
    return {
      content,
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      model: "mock-model",
      provider: "mock",
      cost_usd: 0,
    };
  }
}

function buildExecutor(executedTools: string[], executedParams?: Array<Record<string, JSONValue>>): ReActExecutor {
  return {
    logAgentOutput: async () => {
      await Promise.resolve();
    },
    logDynamicToolCall: async () => {
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
      execute: async (tool: string, params: Record<string, JSONValue>) => {
        executedTools.push(tool);
        executedParams?.push(params);
        await Promise.resolve();
        return { success: true, data: { symbols: [], truncated: false } };
      },
      getTools: () => [],
      getBaseDir: () => "/nonexistent-test-basedir",
    },
  } as ReActExecutor;
}

function toolAction(tool: string): string {
  return `${REACT_THOUGHT_PREFIX}Inspecting symbols.
\`\`\`toml
[[actions]]
tool = "${tool}"
[actions.params]
\`\`\`
`;
}

const blueprint = {
  name: "permissions-test-agent",
  model: "mock:test",
  provider: "mock",
  capabilities: [ExecutionStrategyName.REACT],
  systemPrompt: "",
} satisfies IAgentFileBlueprint;

const context = {
  trace_id: "trace-66666666-6666-6666-8666-666666666666",
  request_id: "request-perm",
  request: "inspect the codebase",
  plan: "call query_symbols",
  portal: "todo-app",
} satisfies IExecutionContext;

function makeOptions(permitted_tools?: string[]): IAgentExecutionOptions {
  return {
    agent_role: "permissions-test-agent",
    portal: "todo-app",
    security_mode: SecurityMode.HYBRID,
    timeout_ms: 300000,
    max_tool_calls: 100,
    audit_enabled: true,
    ...(permitted_tools !== undefined ? { permitted_tools } : {}),
  };
}

Deno.test("[ReAct permissions] an unlisted role's call to query_symbols is rejected before ToolRegistry.execute", async () => {
  const executedTools: string[] = [];
  const provider = new ScriptedProvider([
    toolAction(ToolName.QUERY_SYMBOLS),
    `${REACT_STATUS_COMPLETE}\n${REACT_SUMMARY_PREFIX}done`,
  ]);
  const strategy = new ReActLoopStrategy(buildExecutor(executedTools), provider);

  await strategy.execute(blueprint, context, makeOptions([ToolName.READ_FILE]));

  assertEquals(executedTools, [], "ToolRegistry.execute must never be called for an unlisted tool");
});

Deno.test("[ReAct permissions] a role listing query_symbols in permitted_tools can call it", async () => {
  const executedTools: string[] = [];
  const provider = new ScriptedProvider([
    toolAction(ToolName.QUERY_SYMBOLS),
    `${REACT_STATUS_COMPLETE}\n${REACT_SUMMARY_PREFIX}done`,
  ]);
  const strategy = new ReActLoopStrategy(buildExecutor(executedTools), provider);

  await strategy.execute(blueprint, context, makeOptions([ToolName.QUERY_SYMBOLS]));

  assertEquals(executedTools, [ToolName.QUERY_SYMBOLS], "a listed tool must reach ToolRegistry.execute");
});

Deno.test("[ReAct permissions] get_module_dependencies is rejected the same way when unlisted, and allowed when listed", async () => {
  const rejectedTools: string[] = [];
  const rejectProvider = new ScriptedProvider([
    toolAction(ToolName.GET_MODULE_DEPENDENCIES),
    `${REACT_STATUS_COMPLETE}\n${REACT_SUMMARY_PREFIX}done`,
  ]);
  const rejectStrategy = new ReActLoopStrategy(buildExecutor(rejectedTools), rejectProvider);
  await rejectStrategy.execute(blueprint, context, makeOptions([ToolName.READ_FILE]));
  assertEquals(rejectedTools, []);

  const allowedTools: string[] = [];
  const allowProvider = new ScriptedProvider([
    toolAction(ToolName.GET_MODULE_DEPENDENCIES),
    `${REACT_STATUS_COMPLETE}\n${REACT_SUMMARY_PREFIX}done`,
  ]);
  const allowStrategy = new ReActLoopStrategy(buildExecutor(allowedTools), allowProvider);
  await allowStrategy.execute(blueprint, context, makeOptions([ToolName.GET_MODULE_DEPENDENCIES]));
  assertEquals(allowedTools, [ToolName.GET_MODULE_DEPENDENCIES]);
});

Deno.test("[ReAct graph tools] get_module_dependencies keeps its portal-relative path at dispatch", async () => {
  const executedTools: string[] = [];
  const executedParams: Array<Record<string, JSONValue>> = [];
  const provider = new ScriptedProvider([
    `${REACT_THOUGHT_PREFIX}Inspect imports.\n\`\`\`toml\n[[actions]]\ntool = "get_module_dependencies"\n[actions.params]\npath = "src/router.ts"\ndepth = 2\n\`\`\``,
    `${REACT_STATUS_COMPLETE}\n${REACT_SUMMARY_PREFIX}done`,
  ]);
  const strategy = new ReActLoopStrategy(buildExecutor(executedTools, executedParams), provider);

  await strategy.execute(blueprint, context, makeOptions([ToolName.GET_MODULE_DEPENDENCIES]));

  assertEquals(executedTools, [ToolName.GET_MODULE_DEPENDENCIES]);
  assertEquals(executedParams, [{ path: "src/router.ts", depth: 2 }]);
});

Deno.test("[ReAct permissions] default (no permitted_tools) five-tool exposure is unchanged — query_symbols is not in it", async () => {
  const executedTools: string[] = [];
  const provider = new ScriptedProvider([
    toolAction(ToolName.QUERY_SYMBOLS),
    `${REACT_STATUS_COMPLETE}\n${REACT_SUMMARY_PREFIX}done`,
  ]);
  const strategy = new ReActLoopStrategy(buildExecutor(executedTools), provider);

  await strategy.execute(blueprint, context, makeOptions(undefined));

  assertEquals(executedTools, [], "the default five visible tools do not include query_symbols");
});

Deno.test("[ReAct permissions] AVAILABLE TOOLS prompt text excludes an unlisted graph tool and includes a listed one", () => {
  const strategy = new ReActLoopStrategy(buildExecutor([]));
  const typed = strategy as never as {
    buildPrompt(
      blueprintArg: { name: string; capabilities: string[] },
      contextArg: { trace_id: string; request: string; plan: string; portal: string },
      optionsArg: { agent_role: string; portal: string; permitted_tools?: string[] },
      history: Array<{ role: string; content: string }>,
    ): string;
  };

  const unlistedPrompt = typed.buildPrompt(
    { name: "test", capabilities: ["write"] },
    { trace_id: "t1", request: "req", plan: "plan", portal: "p" },
    { agent_role: "i", portal: "p", permitted_tools: [ToolName.READ_FILE] },
    [],
  );
  const listedPrompt = typed.buildPrompt(
    { name: "test", capabilities: ["write"] },
    { trace_id: "t1", request: "req", plan: "plan", portal: "p" },
    { agent_role: "i", portal: "p", permitted_tools: [ToolName.QUERY_SYMBOLS] },
    [],
  );

  assertEquals(unlistedPrompt.includes(ToolName.QUERY_SYMBOLS), false);
  assertEquals(listedPrompt.includes(ToolName.QUERY_SYMBOLS), true);
});
