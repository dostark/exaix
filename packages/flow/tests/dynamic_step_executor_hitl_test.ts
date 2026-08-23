/**
 * @module DynamicStepExecutorHitlTest
 * @path packages/flow/tests/dynamic_step_executor_hitl_test.ts
 * @description Tests for Phase 118 HITL integration in DynamicStepExecutor.
 */

import { assert, assertEquals } from "@std/assert";
import { FlowStepExecutionMode } from "@exaix/core";
import { DYNAMIC_MODE_APPROVAL_TOOLS, DYNAMIC_MODE_TOOLS, McpToolName } from "@exaix/mcp";
import type { IBlueprintFrontmatter } from "@exaix/schemas/blueprint.ts";
import { FlowStepSchema, type IFlowStep } from "@exaix/schemas/flow.ts";
import type { ToolConfirmationDecision, ToolConfirmationRequest } from "@exaix/schemas/tool_confirmation.ts";
import { DynamicStepExecutor, type IActivityJournal } from "@exaix/flow";
import type {
  HitlRuleSource,
  IHitlPolicyEvaluator,
  IToolConfirmationInterceptor,
  IToolManifestResolver,
  LogMetadata,
} from "@exaix/core/types";
import type { HitlRule } from "@exaix/schemas/hitl.ts";
import type { IMcpClient } from "@exaix/mcp";
import type { ILlmClient, ToolArgs } from "@exaix/ai";

class MockHitlPolicyEvaluator implements IHitlPolicyEvaluator {
  #match: { rule: HitlRule; source: HitlRuleSource } | null;

  constructor(match: { rule: HitlRule; source: HitlRuleSource } | null) {
    this.#match = match;
  }

  evaluate(
    _blueprintRules: HitlRule[],
    _toolName: string,
    _toolArgs: LogMetadata,
  ): { rule: HitlRule; source: HitlRuleSource } | null {
    return this.#match;
  }
}

class RecordingInterceptor implements IToolConfirmationInterceptor {
  requests: ToolConfirmationRequest[] = [];
  #approved: boolean;

  constructor(approved: boolean) {
    this.#approved = approved;
  }

  requestApproval(request: ToolConfirmationRequest): Promise<ToolConfirmationDecision> {
    this.requests.push(request);
    return Promise.resolve({
      id: crypto.randomUUID(),
      approved: this.#approved,
      decidedAt: new Date().toISOString(),
    });
  }
}

class MockMcpClient implements IMcpClient, IToolManifestResolver {
  callTool(_tool: McpToolName, _args: ToolArgs): Promise<string> {
    return Promise.resolve("done");
  }
  getToolDefinitions(_tools: McpToolName[]) {
    return _tools.map((t) => ({
      name: t,
      description: `desc`,
      inputSchema: { type: "object" as const, properties: {} },
    }));
  }
  requiresHumanApproval(_tool: McpToolName): boolean {
    return false;
  }
  getToolChoiceHint(_tool: McpToolName): string | undefined {
    return undefined;
  }
}

class MockLlmClient implements ILlmClient {
  private decisionIndex = 0;

  reasonNextAction(): Promise<{
    done: boolean;
    tool?: McpToolName;
    args?: ToolArgs;
    output?: string;
  }> {
    this.decisionIndex++;
    if (this.decisionIndex > 1) return Promise.resolve({ done: true, output: "completed" });
    return Promise.resolve({ done: false, tool: McpToolName.READ_FILE, args: { path: "/test" } });
  }
}

const mockJournal: IActivityJournal = { log: () => Promise.resolve() };

const step = FlowStepSchema.parse({
  id: "step-1",
  name: "test step",
  retry: { maxAttempts: 1, backoffMs: 0 },
  permitted_tools: [McpToolName.READ_FILE],
  execution_mode: FlowStepExecutionMode.DYNAMIC,
  identity: "test-identity",
  type: "agent",
}) as IFlowStep;

const identity: IBlueprintFrontmatter = {
  name: "test-blueprint",
  description: "a test",
  identity_id: "test-id",
  model: "test:default",
  capabilities: [],
  created: new Date().toISOString(),
  created_by: "test",
  version: "1.0",
  permitted_tools: [McpToolName.READ_FILE],
};

function createExecutor(
  evaluator?: IHitlPolicyEvaluator,
  interceptor?: IToolConfirmationInterceptor,
): DynamicStepExecutor {
  return new DynamicStepExecutor(
    new MockMcpClient(),
    new MockLlmClient(),
    mockJournal,
    interceptor,
    undefined,
    evaluator,
    DYNAMIC_MODE_TOOLS,
    DYNAMIC_MODE_APPROVAL_TOOLS,
  );
}

Deno.test("hitl: blueprint rule on a dynamic tool triggers confirmation", async () => {
  const evaluator = new MockHitlPolicyEvaluator({
    rule: { tool: McpToolName.READ_FILE, path_pattern: "**/.env*", reason: "Sensitive file" },
    source: "blueprint" as HitlRuleSource,
  });
  const interceptor = new RecordingInterceptor(true);
  const executor = createExecutor(evaluator, interceptor);

  const result = await executor.execute(step, identity, "input", { traceId: "trace-1" });
  assert(result.completed);
  assertEquals(interceptor.requests.length, 1);
  assertEquals(interceptor.requests[0].toolName, McpToolName.READ_FILE);
  assertEquals(interceptor.requests[0].reason, "Sensitive file");
});

Deno.test("hitl: matching tool on non-matching arg does NOT trigger confirmation", async () => {
  const evaluator = new MockHitlPolicyEvaluator(null);
  const interceptor = new RecordingInterceptor(true);
  const executor = createExecutor(evaluator, interceptor);

  const result = await executor.execute(step, identity, "input", { traceId: "trace-2" });
  assert(result.completed);
  assertEquals(interceptor.requests.length, 0);
});

Deno.test("hitl: no evaluator injected => identical to manifest-only behaviour", async () => {
  const interceptor = new RecordingInterceptor(true);
  const executor = createExecutor(undefined, interceptor);

  const result = await executor.execute(step, identity, "input", { traceId: "trace-3" });
  assert(result.completed);
  assertEquals(interceptor.requests.length, 0);
});

Deno.test("hitl: denial aborts the tool and continues the ReAct loop", async () => {
  const evaluator = new MockHitlPolicyEvaluator({
    rule: { tool: McpToolName.READ_FILE },
    source: "blueprint" as HitlRuleSource,
  });
  const interceptor = new RecordingInterceptor(false);
  const executor = createExecutor(evaluator, interceptor);

  const result = await executor.execute(step, identity, "input", { traceId: "trace-4" });
  assert(result.completed);
  assertEquals(interceptor.requests.length, 1);
});
