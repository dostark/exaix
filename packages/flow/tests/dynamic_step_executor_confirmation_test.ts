/**
 * @module DynamicStepExecutorConfirmationTest
 * @path packages/flow/tests/dynamic_step_executor_confirmation_test.ts
 * @description Regression tests for Phase 79 confirmation gating inside
 * DynamicStepExecutor. Covers approval, denial, no-interceptor fallback,
 * and the defensive approval-required branch.
 */

import { createDynamicExecutor } from "./helpers/dynamic_executor.ts";
import { assert, assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import {
  DEFAULT_TOOL_CONFIRMATION_TIMEOUT_S,
  FlowStepExecutionMode,
  TOOL_CONFIRMATION_EVENT_APPROVED,
  TOOL_CONFIRMATION_EVENT_DENIED,
  ToolErrorCode,
} from "@exaix/core";
import type { IToolConfirmationInterceptor, IToolManifestResolver } from "@exaix/core/types";
import { McpToolName } from "@exaix/mcp";
import type { IMcpClient } from "@exaix/mcp";
import { BlueprintFrontmatterSchema, type IBlueprintFrontmatter } from "@exaix/schemas/blueprint.ts";
import { FlowStepSchema, type IFlowStep } from "@exaix/schemas/flow.ts";
import type { ToolConfirmationDecision, ToolConfirmationRequest } from "@exaix/schemas/tool_confirmation.ts";
import { DynamicStepExecutor, type IActivityJournal, type JournalEntry } from "@exaix/flow";
import type { ILlmClient, ToolArgs } from "@exaix/ai";
import type { JSONValue } from "@exaix/core";

class MockMcpClient implements IMcpClient, IToolManifestResolver {
  private readonly responses = new Map<McpToolName, string>();
  private readonly approvalTools = new Set<McpToolName>();
  private callHistory: Array<{ tool: McpToolName; args: ToolArgs }> = [];
  private capturedTools: McpToolName[] = [];

  setResponse(tool: McpToolName, response: string) {
    this.responses.set(tool, response);
  }

  setRequiresApproval(tool: McpToolName, required: boolean) {
    if (required) {
      this.approvalTools.add(tool);
      return;
    }
    this.approvalTools.delete(tool);
  }

  getCallHistory() {
    return [...this.callHistory];
  }

  getCapturedTools() {
    return [...this.capturedTools];
  }

  callTool(tool: McpToolName, args: ToolArgs): Promise<string> {
    this.callHistory.push({ tool, args });
    return Promise.resolve(this.responses.get(tool) ?? `Result from ${tool}`);
  }

  getToolDefinitions(tools: McpToolName[]) {
    this.capturedTools = [...tools];
    return tools.map((tool) => ({
      name: tool,
      description: `Description of ${tool}`,
      inputSchema: { type: "object" as const, properties: {} },
    }));
  }

  requiresHumanApproval(tool: McpToolName): boolean {
    return this.approvalTools.has(tool);
  }
}

class MockLlmClient implements ILlmClient {
  private decisions: Array<{
    done: boolean;
    tool?: McpToolName;
    args?: ToolArgs;
    output?: string;
  }> = [];
  private decisionIndex = 0;

  createNativeConversation() {
    return Promise.resolve({ initialPrompt: "", turns: [] });
  }

  setDecisions(
    decisions: Array<{
      done: boolean;
      tool?: McpToolName;
      args?: ToolArgs;
      output?: string;
    }>,
  ) {
    this.decisions = decisions;
    this.decisionIndex = 0;
  }

  reasonNextAction(_params: {
    agent_role: IBlueprintFrontmatter;
    stepObjective: string;
    accumulatedContext: string;
    availableTools: Array<{ name: string; description: string; inputSchema: Record<string, JSONValue> }>;
    iteration: number;
    maxIterations: number;
  }): Promise<{ done: boolean; tool?: McpToolName; args?: ToolArgs; output?: string }> {
    const next = this.decisions[this.decisionIndex++] ?? { done: true, output: "Completed" };
    return Promise.resolve(next);
  }
}

class MockActivityJournal implements IActivityJournal {
  private entries: Array<JournalEntry> = [];

  getEntries() {
    return [...this.entries];
  }

  log(entry: JournalEntry): Promise<void> {
    this.entries.push(entry);
    return Promise.resolve();
  }
}

class RecordingConfirmationInterceptor implements IToolConfirmationInterceptor {
  private requests: ToolConfirmationRequest[] = [];

  constructor(private readonly decisionFactory: (request: ToolConfirmationRequest) => ToolConfirmationDecision) {}

  getRequests() {
    return [...this.requests];
  }

  requestApproval(request: ToolConfirmationRequest): Promise<ToolConfirmationDecision> {
    this.requests.push(request);
    return Promise.resolve(this.decisionFactory(request));
  }
}

function createAgentRole() {
  return BlueprintFrontmatterSchema.parse({
    agent_role: "senior-coder",
    name: "Senior Coder",
    model: "anthropic:claude-3-opus",
    created: new Date().toISOString(),
    created_by: "test",
    permitted_tools: [McpToolName.REQUEST_CREATE, McpToolName.PLAN_LIST, McpToolName.READ_FILE],
  });
}

function createDynamicStep() {
  return FlowStepSchema.parse({
    id: "step-confirmation",
    name: "Create request if needed",
    agent_role: "senior-coder",
    execution_mode: FlowStepExecutionMode.DYNAMIC,
    permitted_tools: [McpToolName.REQUEST_CREATE, McpToolName.PLAN_LIST, McpToolName.READ_FILE],
  });
}

class ApprovalForcingExecutor extends DynamicStepExecutor {
  protected override resolvePermittedTools(
    _step: IFlowStep,
    _agent_role: IBlueprintFrontmatter,
  ): McpToolName[] {
    return [McpToolName.REQUEST_CREATE];
  }
}

interface IApprovalCase {
  mcpClient: MockMcpClient;
  llmClient: MockLlmClient;
  journal: MockActivityJournal;
  interceptor: RecordingConfirmationInterceptor;
  executor: DynamicStepExecutor;
}

function approvalCase(title: string, response: string | null): IApprovalCase {
  const mcpClient = new MockMcpClient();
  mcpClient.setRequiresApproval(McpToolName.REQUEST_CREATE, true);
  if (response !== null) mcpClient.setResponse(McpToolName.REQUEST_CREATE, response);
  const llmClient = new MockLlmClient();
  llmClient.setDecisions([
    { done: false, tool: McpToolName.REQUEST_CREATE, args: { title } },
    { done: true, output: "done" },
  ]);
  const journal = new MockActivityJournal();
  const interceptor = new RecordingConfirmationInterceptor((request) => ({
    id: request.id,
    approved: true,
    decidedAt: new Date().toISOString(),
  }));
  const executor = createDynamicExecutor({
    mcpClient,
    llmClient,
    activityJournal: journal,
    confirmationInterceptor: interceptor,
  });
  return { mcpClient, llmClient, journal, interceptor, executor };
}

Deno.test("DynamicStepExecutor confirmation: approved approval-required tool executes", async () => {
  const { mcpClient, journal, interceptor, executor } = approvalCase("New request", "request created");

  const result = await executor.execute(createDynamicStep(), createAgentRole(), "input", { traceId: "trace-approval" });

  assertEquals(result.completed, true);
  assertEquals(mcpClient.getCallHistory().length, 1);
  assertEquals(mcpClient.getCallHistory()[0].tool, McpToolName.REQUEST_CREATE);
  assertEquals(interceptor.getRequests().length, 1);
  assertEquals(interceptor.getRequests()[0].toolName, McpToolName.REQUEST_CREATE);
  assertStringIncludes(interceptor.getRequests()[0].expiresAt, "T");
  assert(
    journal.getEntries().some((entry) => entry.event === TOOL_CONFIRMATION_EVENT_APPROVED),
    "approval event must be written to the activity journal",
  );
});

Deno.test("DynamicStepExecutor confirmation: denied approval-required tool returns observation and continues", async () => {
  const mcpClient = new MockMcpClient();
  mcpClient.setRequiresApproval(McpToolName.REQUEST_CREATE, true);

  const llmClient = new MockLlmClient();
  llmClient.setDecisions([
    { done: false, tool: McpToolName.REQUEST_CREATE, args: { title: "Denied request" } },
    { done: true },
  ]);

  const journal = new MockActivityJournal();
  const interceptor = new RecordingConfirmationInterceptor((request) => ({
    id: request.id,
    approved: false,
    reason: "User declined",
    decidedAt: new Date().toISOString(),
  }));

  const executor = createDynamicExecutor({
    mcpClient,
    llmClient,
    activityJournal: journal,
    confirmationInterceptor: interceptor,
  });

  const result = await executor.execute(createDynamicStep(), createAgentRole(), "input", { traceId: "trace-denial" });

  assertEquals(mcpClient.getCallHistory().length, 0);
  assertEquals(result.completed, true);
  assertStringIncludes(result.output, "Tool 'exaix_request_create' call denied: User declined");
  assert(
    journal.getEntries().some((entry) => entry.event === TOOL_CONFIRMATION_EVENT_DENIED),
    "denial event must be written to the activity journal",
  );
  assert(
    journal.getEntries().some((entry) => entry.toolErrorCode === ToolErrorCode.PERMISSION_DENIED),
    "denial journal entry must include ToolErrorCode.PERMISSION_DENIED",
  );
});

Deno.test("DynamicStepExecutor confirmation: without interceptor approval-required tools are excluded from tool surface", async () => {
  const mcpClient = new MockMcpClient();
  mcpClient.setRequiresApproval(McpToolName.REQUEST_CREATE, true);

  const llmClient = new MockLlmClient();
  llmClient.setDecisions([{ done: true, output: "done" }]);

  const journal = new MockActivityJournal();
  const executor = createDynamicExecutor({
    mcpClient,
    llmClient,
    activityJournal: journal,
  });

  await executor.execute(createDynamicStep(), createAgentRole(), "input", { traceId: "trace-no-interceptor" });

  assert(!mcpClient.getCapturedTools().includes(McpToolName.REQUEST_CREATE));
  const getCapturedToolsIncludesLIST_PLANS: boolean = mcpClient.getCapturedTools().includes(McpToolName.PLAN_LIST);
  assert(getCapturedToolsIncludesLIST_PLANS, "getCapturedTools should include McpToolName.PLAN_LIST");
});

Deno.test("DynamicStepExecutor confirmation: defensive throw when approval-required tool is reached without interceptor", async () => {
  const mcpClient = new MockMcpClient();
  mcpClient.setRequiresApproval(McpToolName.REQUEST_CREATE, true);

  const llmClient = new MockLlmClient();
  llmClient.setDecisions([{ done: false, tool: McpToolName.REQUEST_CREATE, args: {} }]);

  const journal = new MockActivityJournal();
  const executor = new ApprovalForcingExecutor({ mcpClient, llmClient, activityJournal: journal });

  await assertRejects(
    () => executor.execute(createDynamicStep(), createAgentRole(), "input", { traceId: "trace-defensive" }),
    Error,
    "requires human approval",
  );
});

Deno.test("DynamicStepExecutor confirmation: approval request timeout window uses Phase 79 default", async () => {
  const { interceptor, executor } = approvalCase("Needs approval", null);

  await executor.execute(createDynamicStep(), createAgentRole(), "input", { traceId: "trace-timeout-default" });

  const request = interceptor.getRequests()[0];
  const requestedAt = new Date(request.requestedAt).getTime();
  const expiresAt = new Date(request.expiresAt).getTime();
  assertEquals(expiresAt - requestedAt, DEFAULT_TOOL_CONFIRMATION_TIMEOUT_S * 1000);
});

Deno.test("DynamicStepExecutor confirmation: config override changes approval request timeout window", async () => {
  const { interceptor, executor } = approvalCase("Config timeout test", "created");

  await executor.execute(createDynamicStep(), createAgentRole(), "input", {
    traceId: "trace-config-timeout",
    config: { tools: { confirmation_timeout_s: 60 } },
  });

  const request = interceptor.getRequests()[0];
  const requestedAt = new Date(request.requestedAt).getTime();
  const expiresAt = new Date(request.expiresAt).getTime();
  assertEquals(expiresAt - requestedAt, 60 * 1000, "expiresAt must reflect config override of 60 s");
});
