/**
 * @module DynamicStepExecutorNativeReplayTest
 * @path packages/flow/tests/dynamic_step_executor_native_replay_test.ts
 * @description Verifies dynamic-step native call replay preserves approval and call identity.
 * @architectural-layer Flows
 * @related-files [packages/flow/src/dynamic_step_executor.ts, packages/ai/src/types.ts]
 */
import { assertEquals } from "@std/assert";
import { FlowStepExecutionMode } from "@exaix/core";
import { DYNAMIC_MODE_APPROVAL_TOOLS, DYNAMIC_MODE_TOOLS, McpToolName } from "@exaix/mcp";
import type { IMcpClient, IMcpToolCallContext } from "@exaix/mcp";
import type { IToolManifestResolver } from "@exaix/core/types";
import type { IToolConfirmationInterceptor } from "@exaix/core/types";
import type { Opt, Reason } from "@exaix/core/types";
import type { IBlueprintFrontmatter } from "@exaix/schemas/blueprint.ts";
import type { ILlmClient, ToolArgs } from "@exaix/ai";
import type { INativeConversationSnapshot } from "@exaix/ai";
import type { ToolConfirmationDecision, ToolConfirmationRequest } from "@exaix/schemas/tool_confirmation.ts";
import { DynamicStepExecutor, type IActivityJournal, type JournalEntry } from "@exaix/flow";
import { FlowStepSchema } from "@exaix/schemas/flow.ts";

class ReplayMcpClient implements IMcpClient, IToolManifestResolver {
  executions: Array<{ tool: McpToolName; args: ToolArgs }> = [];
  approvalTools = new Set<McpToolName>();
  failure?: Error;
  getToolDefinitions(tools: McpToolName[]) {
    return tools.map((name) => ({ name, description: `Use ${name}`, inputSchema: {} }));
  }
  callTool(tool: McpToolName, args: ToolArgs, _context?: Opt<IMcpToolCallContext, Reason.OptionalInput>) {
    this.executions.push({ tool, args });
    if (this.failure) return Promise.reject(this.failure);
    return Promise.resolve("tool-output");
  }
  requiresHumanApproval(tool: McpToolName) {
    return this.approvalTools.has(tool);
  }
}

class ReplayLlmClient implements ILlmClient {
  calls: Array<{ nativeToolsEnabled?: boolean; traceId?: string; nativeConversation?: INativeConversationSnapshot }> =
    [];
  decisions: Array<Awaited<ReturnType<ILlmClient["reasonNextAction"]>>> = [];
  createNativeConversation(): Promise<INativeConversationSnapshot> {
    return Promise.resolve({ initialPrompt: "dynamic prompt", turns: [] });
  }
  reasonNextAction(params: Parameters<ILlmClient["reasonNextAction"]>[0]) {
    this.calls.push({
      nativeToolsEnabled: params.nativeToolsEnabled,
      traceId: params.traceId,
      nativeConversation: params.nativeConversation,
    });
    return Promise.resolve(this.decisions.shift() ?? { done: true, output: "finished" });
  }
}

class ReplayJournal implements IActivityJournal {
  entries: JournalEntry[] = [];
  log(entry: JournalEntry): Promise<void> {
    this.entries.push(entry);
    return Promise.resolve();
  }
}

const role: IBlueprintFrontmatter = {
  agent_role: "reviewer",
  name: "Reviewer",
  description: "Read files",
  model: "test:model",
  permitted_tools: [McpToolName.READ_FILE],
  created: "2026-01-01",
  created_by: "test",
  version: "1.0.0",
  capabilities: [],
};

const step = FlowStepSchema.parse({
  id: "dynamic-step",
  name: "Review file",
  agent_role: "reviewer",
  execution_mode: FlowStepExecutionMode.DYNAMIC,
  permitted_tools: [McpToolName.READ_FILE],
});

Deno.test("DynamicStepExecutor forwards native controls and replays exact successful call id", async () => {
  const mcp = new ReplayMcpClient();
  const llm = new ReplayLlmClient();
  const executor = new DynamicStepExecutor(
    mcp,
    llm,
    new ReplayJournal(),
    undefined,
    undefined,
    undefined,
    DYNAMIC_MODE_TOOLS,
    DYNAMIC_MODE_APPROVAL_TOOLS,
  );
  llm.decisions = [
    {
      done: false,
      tool: McpToolName.READ_FILE,
      args: { path: "src/a.ts" },
      nativeToolCall: { id: "call-22", name: McpToolName.READ_FILE, input: { path: "src/a.ts" } },
    },
    { done: true, output: "reviewed" },
  ];
  await executor.execute(step, role, "Review src/a.ts", {
    traceId: "trace-22",
    config: { execution: { native_tools_enabled: true } },
  });
  assertEquals(llm.calls[0].nativeToolsEnabled, true);
  assertEquals(llm.calls[0].traceId, "trace-22");
  assertEquals(mcp.executions.length, 1);
  assertEquals(llm.calls[1].nativeConversation?.turns[0].toolUseId, "call-22");
});

Deno.test("DynamicStepExecutor replays denied native call as an error without executing it", async () => {
  const mcp = new ReplayMcpClient();
  const approvalTool = McpToolName.CREATE_REQUEST;
  mcp.approvalTools.add(approvalTool);
  let approvalRequest: ToolConfirmationRequest | undefined;
  const interceptor: IToolConfirmationInterceptor = {
    requestApproval(request: ToolConfirmationRequest): Promise<ToolConfirmationDecision> {
      approvalRequest = request;
      return Promise.resolve({
        id: request.id,
        approved: false,
        reason: "not authorized",
        decidedAt: "2026-01-01T00:00:00.000Z",
      });
    },
  };
  const llm = new ReplayLlmClient();
  const executor = new DynamicStepExecutor(
    mcp,
    llm,
    new ReplayJournal(),
    interceptor,
    undefined,
    undefined,
    DYNAMIC_MODE_TOOLS,
    DYNAMIC_MODE_APPROVAL_TOOLS,
  );
  llm.decisions = [
    {
      done: false,
      tool: approvalTool,
      args: { request: "create" },
      nativeToolCall: { id: "call-denied-8", name: approvalTool, input: { request: "create" } },
    },
    { done: true, output: "finished" },
  ];
  const result = await executor.execute(
    { ...step, permitted_tools: [...(step.permitted_tools ?? []), approvalTool] },
    { ...role, permitted_tools: [...(role.permitted_tools ?? []), approvalTool] },
    "Review src/a.ts",
    { traceId: "trace-denied-8", config: { execution: { native_tools_enabled: true } } },
  );
  assertEquals(approvalRequest?.toolName, approvalTool);
  assertEquals(mcp.executions.length, 0);
  assertEquals(result.completed, true);
  assertEquals(llm.calls[1].nativeConversation?.turns[0], {
    toolUseId: "call-denied-8",
    toolName: approvalTool,
    toolInput: { request: "create" },
    toolResultContent: "Tool 'exaix_create_request' call denied: not authorized",
    toolResultIsError: true,
  });
});

Deno.test("DynamicStepExecutor does not replay an incomplete native turn after a tool failure", async () => {
  const mcp = new ReplayMcpClient();
  mcp.failure = new Error("portal access denied");
  const llm = new ReplayLlmClient();
  const journal = new ReplayJournal();
  const executor = new DynamicStepExecutor(
    mcp,
    llm,
    journal,
    undefined,
    undefined,
    undefined,
    DYNAMIC_MODE_TOOLS,
    DYNAMIC_MODE_APPROVAL_TOOLS,
  );
  llm.decisions = [{
    done: false,
    tool: McpToolName.READ_FILE,
    args: { path: "outside/secret.ts" },
    nativeToolCall: { id: "call-failed-9", name: McpToolName.READ_FILE, input: { path: "outside/secret.ts" } },
  }];
  try {
    await executor.execute(step, role, "Read file", {
      traceId: "trace-failed-9",
      config: { execution: { native_tools_enabled: true } },
    });
    throw new Error("Expected tool failure to escape the dynamic executor");
  } catch (error) {
    assertEquals(error, mcp.failure);
  }
  assertEquals(llm.calls.length, 1);
  assertEquals(llm.calls[0].nativeConversation?.turns.length, 0);
  assertEquals(journal.entries.some((entry) => entry.event === "dynamic_step_completed"), false);
});

Deno.test("DynamicStepExecutor starts each invocation with an empty native replay", async () => {
  const mcp = new ReplayMcpClient();
  const llm = new ReplayLlmClient();
  const executor = new DynamicStepExecutor(
    mcp,
    llm,
    new ReplayJournal(),
    undefined,
    undefined,
    undefined,
    DYNAMIC_MODE_TOOLS,
    DYNAMIC_MODE_APPROVAL_TOOLS,
  );
  const config = { execution: { native_tools_enabled: true } };
  for (const traceId of ["trace-isolated-1", "trace-isolated-2"]) {
    llm.decisions.push(
      {
        done: false,
        tool: McpToolName.READ_FILE,
        args: { path: "src/a.ts" },
        nativeToolCall: { id: `call-${traceId}`, name: McpToolName.READ_FILE, input: { path: "src/a.ts" } },
      },
      { done: true, output: "finished" },
    );
    await executor.execute(step, role, "Read file", { traceId, config });
  }
  assertEquals(llm.calls[0].nativeConversation?.turns.length, 0);
  assertEquals(llm.calls[2].nativeConversation?.turns.length, 0);
  assertEquals(mcp.executions.length, 2);
});
