/**
 * @module DynamicStepExecutorToolSurfaceTest
 * @path packages/flow/tests/dynamic_step_executor_tool_surface_test.ts
 * @description Verifies that DynamicStepExecutor resolves its permitted tool surface from
 * the canonical manifest (DYNAMIC_MODE_TOOLS) rather than the READ_ONLY_TOOLS constant,
 * ensuring domain tools with requires_human_approval are correctly excluded.
 */

import { createDynamicExecutor, dynamicAgentRole } from "./helpers/dynamic_executor.ts";
import { assert, assertEquals, assertFalse } from "@std/assert";
import type { IToolManifestResolver } from "@exaix/core/types";
import { DYNAMIC_MODE_TOOLS, McpToolName, TOOL_MANIFEST } from "@exaix/mcp";
import type { IMcpClient } from "@exaix/mcp";
import { FlowStepExecutionMode } from "@exaix/core";

import { FlowStepSchema } from "@exaix/schemas/flow.ts";
import type { DynamicStepExecutor, IActivityJournal, JournalEntry } from "@exaix/flow";
import type { ILlmClient, ToolArgs } from "@exaix/ai";
import type { JSONValue } from "@exaix/core";
import type { IBlueprintFrontmatter } from "@exaix/schemas/blueprint.ts";

// Minimal stubs

class CapturingMcpClient implements IMcpClient, IToolManifestResolver {
  capturedTools: McpToolName[] = [];

  callTool(_tool: McpToolName, _args: ToolArgs): Promise<string> {
    return Promise.resolve("result");
  }

  getToolDefinitions(tools: McpToolName[]): Array<{
    name: string;
    description: string;
    inputSchema: Record<string, JSONValue>;
  }> {
    this.capturedTools = [...tools];
    return tools.map((t) => ({
      name: t,
      description: `Description of ${t}`,
      inputSchema: { type: "object" as const, properties: {} },
    }));
  }

  requiresHumanApproval(_tool: McpToolName): boolean {
    return false;
  }
}

class ImmediateDoneLlmClient implements ILlmClient {
  createNativeConversation() {
    return Promise.resolve({ initialPrompt: "", turns: [] });
  }
  reasonNextAction(_params: {
    agent_role: IBlueprintFrontmatter;
    stepObjective: string;
    accumulatedContext: string;
    availableTools: Array<{ name: string; description: string; inputSchema: Record<string, JSONValue> }>;
    iteration: number;
    maxIterations: number;
  }): Promise<{ done: boolean; tool?: McpToolName; args?: ToolArgs; output?: string }> {
    return Promise.resolve({ done: true, output: "done" });
  }
}

class NoopJournal implements IActivityJournal {
  log(_entry: JournalEntry): Promise<void> {
    return Promise.resolve();
  }
}

// All McpToolName values the agent role says it can use
const allToolNames = Object.values(McpToolName) as McpToolName[];

// Constant tests

interface IDynamicCase {
  mcpClient: CapturingMcpClient;
  llmClient: ImmediateDoneLlmClient;
  journal: NoopJournal;
  executor: DynamicStepExecutor;
}
function dynamicCase(): IDynamicCase {
  const mcpClient = new CapturingMcpClient();
  const llmClient = new ImmediateDoneLlmClient();
  const journal = new NoopJournal();
  return {
    mcpClient,
    llmClient,
    journal,
    executor: createDynamicExecutor({ mcpClient, llmClient, activityJournal: journal }),
  };
}

Deno.test("DYNAMIC_MODE_TOOLS derives exactly from manifest dynamic_mode_allowed entries", () => {
  const manifestDerivedDynamic = new Set(
    TOOL_MANIFEST
      .filter((e) => e.dynamic_mode_allowed && !e.requires_human_approval)
      .map((e) => e.name),
  );

  assertEquals(
    [...DYNAMIC_MODE_TOOLS].sort(),
    [...manifestDerivedDynamic].sort(),
    "DYNAMIC_MODE_TOOLS must exactly match manifest entries where dynamic_mode_allowed && !requires_human_approval",
  );
});

Deno.test("DYNAMIC_MODE_TOOLS includes read-only domain tools list_plans and query_journal", () => {
  assert(DYNAMIC_MODE_TOOLS.has(McpToolName.PLAN_LIST), "list_plans must be in DYNAMIC_MODE_TOOLS");
  assert(DYNAMIC_MODE_TOOLS.has(McpToolName.LOG_LIST), "query_journal must be in DYNAMIC_MODE_TOOLS");
});

Deno.test("DYNAMIC_MODE_TOOLS excludes requires_human_approval domain tools", () => {
  assertFalse(DYNAMIC_MODE_TOOLS.has(McpToolName.REQUEST_CREATE), "create_request has requires_human_approval=true");
  assertFalse(DYNAMIC_MODE_TOOLS.has(McpToolName.PLAN_APPROVE), "approve_plan has requires_human_approval=true");
});

Deno.test("DYNAMIC_MODE_TOOLS excludes write and git mutation tools", () => {
  assertFalse(DYNAMIC_MODE_TOOLS.has(McpToolName.WRITE_FILE));
  assertFalse(DYNAMIC_MODE_TOOLS.has(McpToolName.GIT_COMMIT));
  assertFalse(DYNAMIC_MODE_TOOLS.has(McpToolName.RUN_COMMAND));
});

// DynamicStepExecutor behavioural tests

Deno.test(
  "DynamicStepExecutor resolves permitted tools from canonical manifest set, not arbitrary agent-role list",
  async () => {
    const { mcpClient, executor } = dynamicCase();

    const agentRole = dynamicAgentRole(allToolNames, "test-agent", "Test Agent");

    const step = FlowStepSchema.parse({
      id: "step-1",
      name: "Canonical surface test",
      agent_role: "test-agent",
      execution_mode: FlowStepExecutionMode.DYNAMIC,
      // no permitted_tools override — inherits from agent role
    });

    await executor.execute(step, agentRole, "test input", { traceId: "t1" });

    // The captured effective tools must be a subset of DYNAMIC_MODE_TOOLS
    for (const tool of mcpClient.capturedTools) {
      assert(
        DYNAMIC_MODE_TOOLS.has(tool),
        `Tool ${tool} appeared in effective set but is not in DYNAMIC_MODE_TOOLS`,
      );
    }

    // And the canonical dynamic tools present in agent role's permitted_tools must all appear
    const agentRoleSet = new Set(allToolNames);
    const expectedPresent = [...DYNAMIC_MODE_TOOLS].filter((t) => agentRoleSet.has(t as McpToolName));
    assertEquals(
      mcpClient.capturedTools.sort(),
      (expectedPresent as McpToolName[]).sort(),
      "Effective tools must equal DYNAMIC_MODE_TOOLS intersected with agent-role permitted_tools",
    );
  },
);

Deno.test(
  "DynamicStepExecutor filters requires_human_approval domain tools even when agent role permits them",
  async () => {
    const { mcpClient, executor } = dynamicCase();

    const agentRole = dynamicAgentRole(
      [
        McpToolName.READ_FILE,
        McpToolName.REQUEST_CREATE, // requires_human_approval: true
        McpToolName.PLAN_APPROVE, // requires_human_approval: true
        McpToolName.PLAN_LIST, // requires_human_approval: false — should be included
      ],
      "test-agent",
      "Test Agent",
    );

    const step = FlowStepSchema.parse({
      id: "step-2",
      name: "Domain tool filter test",
      agent_role: "test-agent",
      execution_mode: FlowStepExecutionMode.DYNAMIC,
    });

    await executor.execute(step, agentRole, "test input", { traceId: "t2" });

    assertFalse(
      mcpClient.capturedTools.includes(McpToolName.REQUEST_CREATE),
      "create_request must be filtered out (requires_human_approval: true)",
    );
    assertFalse(
      mcpClient.capturedTools.includes(McpToolName.PLAN_APPROVE),
      "approve_plan must be filtered out (requires_human_approval: true)",
    );
    const capturedToolsIncludesLIST_PLANS: boolean = mcpClient.capturedTools.includes(McpToolName.PLAN_LIST);
    assert(capturedToolsIncludesLIST_PLANS, "list_plans must be included (requires_human_approval: false)");
    const capturedToolsIncludesREAD_FILE: boolean = mcpClient.capturedTools.includes(McpToolName.READ_FILE);
    assert(capturedToolsIncludesREAD_FILE, "read_file must be included");
  },
);
