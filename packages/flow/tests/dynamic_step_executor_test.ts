// deno-lint-ignore-file no-explicit-any
/**
 * @module DynamicStepExecutorTest
 * @path packages/flow/tests/dynamic_step_executor_test.ts
 * @description Verifies DynamicStepExecutor ReAct-style dynamic tool selection for Phase 56.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { FlowStepExecutionMode } from "@exaix/core";
import { McpToolName } from "@exaix/mcp";
import type { IMcpClient } from "@exaix/mcp";
import type { IToolManifestResolver } from "@exaix/core/types";
import { FlowStepSchema } from "@exaix/schemas/flow.ts";
import { BlueprintFrontmatterSchema } from "@exaix/schemas/blueprint.ts";
import type { ILlmClient, ToolArgs } from "@exaix/ai";
import { DynamicStepExecutor, type IActivityJournal, type JournalEntry } from "@exaix/flow";

/**
 * Mock implementations for dependencies
 */
class MockMcpClient implements IMcpClient, IToolManifestResolver {
  private callHistory: Array<{ tool: McpToolName; args: ToolArgs }> = [];
  private responses: Map<string, string> = new Map();

  setResponse(tool: McpToolName, response: string) {
    this.responses.set(tool, response);
  }

  getCallHistory() {
    return [...this.callHistory];
  }

  callTool(tool: McpToolName, args: ToolArgs): Promise<string> {
    this.callHistory.push({ tool, args });
    return Promise.resolve(this.responses.get(tool) ?? `Result from ${tool}`);
  }

  getToolDefinitions(tools: McpToolName[]) {
    return tools.map((t) => ({
      name: t,
      description: `Description of ${t}`,
      inputSchema: { type: "object" as const, properties: {} },
    }));
  }

  requiresHumanApproval(_tool: McpToolName): boolean {
    return false;
  }

  reset() {
    this.callHistory = [];
    this.responses.clear();
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

  reasonNextAction(
    _params: any,
  ): Promise<{ done: boolean; tool?: McpToolName; args?: ToolArgs; output?: string }> {
    if (this.decisionIndex >= this.decisions.length) {
      // Default to done if no more decisions
      return Promise.resolve({ done: true, output: "Completed" });
    }
    return Promise.resolve(this.decisions[this.decisionIndex++]);
  }

  reset() {
    this.decisions = [];
    this.decisionIndex = 0;
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

  reset() {
    this.entries = [];
  }
}

/**
 * Tests for Phase 56 Step 3: DynamicStepExecutor
 */

Deno.test("DynamicStepExecutor: successful execution with tool calls", async () => {
  const mcpClient = new MockMcpClient();
  const llmClient = new MockLlmClient();
  const journal = new MockActivityJournal();
  const executor = new DynamicStepExecutor(mcpClient, llmClient, journal);

  const identity = BlueprintFrontmatterSchema.parse({
    identity_id: "senior-coder",
    name: "Senior Coder",
    model: "anthropic:claude-3-opus",
    created: new Date().toISOString(),
    created_by: "test",
    permitted_tools: [McpToolName.READ_FILE, McpToolName.LIST_DIRECTORY],
  });

  const step = FlowStepSchema.parse({
    id: "step-1",
    name: "Search for bugs",
    identity: "senior-coder",
    execution_mode: FlowStepExecutionMode.DYNAMIC,
    permitted_tools: [McpToolName.READ_FILE],
  });

  llmClient.setDecisions([
    { done: false, tool: McpToolName.READ_FILE, args: { path: "main.ts" } },
    { done: true, output: "No bugs found" },
  ]);
  mcpClient.setResponse(McpToolName.READ_FILE, "console.log('hello');");

  const result = await executor.execute(step, identity, "Find bugs in main.ts", {
    traceId: "trace-1",
  });

  assertEquals(result.completed, true);
  assertEquals(result.output, "No bugs found");
  assertEquals(result.toolCallsLog.length, 1);
  assertEquals(result.toolCallsLog[0].tool, McpToolName.READ_FILE);
  assertEquals(result.iterations, 2);

  const entries = journal.getEntries();
  assertEquals(entries.some((e) => e.event === "dynamic_tool_call"), true);
  assertEquals(entries.some((e) => e.event === "dynamic_step_completed"), true);
});

Deno.test("DynamicStepExecutor: stops at max iterations", async () => {
  const mcpClient = new MockMcpClient();
  const llmClient = new MockLlmClient();
  const journal = new MockActivityJournal();
  const executor = new DynamicStepExecutor(mcpClient, llmClient, journal);

  const identity = BlueprintFrontmatterSchema.parse({
    identity_id: "senior-coder",
    name: "Senior Coder",
    model: "anthropic:claude-3-opus",
    created: new Date().toISOString(),
    created_by: "test",
    permitted_tools: [McpToolName.READ_FILE],
  });

  const step = FlowStepSchema.parse({
    id: "step-1",
    name: "Infinite loop",
    identity: "senior-coder",
    execution_mode: FlowStepExecutionMode.DYNAMIC,
    timeout: 2000, // This will set maxIterations to 2 (Math.min(10, 2000/1000))
  });

  llmClient.setDecisions([
    { done: false, tool: McpToolName.READ_FILE, args: { path: "1.ts" } },
    { done: false, tool: McpToolName.READ_FILE, args: { path: "2.ts" } },
    { done: false, tool: McpToolName.READ_FILE, args: { path: "3.ts" } },
  ]);

  const result = await executor.execute(step, identity, "Go", { traceId: "trace-2" });

  assertEquals(result.completed, false);
  assertEquals(result.iterations, 2);
  assertEquals(result.toolCallsLog.length, 2);
  assertEquals(
    journal.getEntries().some((e) => e.event === "dynamic_step_max_iterations_reached"),
    true,
  );
});

Deno.test("DynamicStepExecutor: throws when model selects non-permitted tool", async () => {
  const mcpClient = new MockMcpClient();
  const llmClient = new MockLlmClient();
  const journal = new MockActivityJournal();
  const executor = new DynamicStepExecutor(mcpClient, llmClient, journal);

  const identity = BlueprintFrontmatterSchema.parse({
    identity_id: "senior-coder",
    name: "Senior Coder",
    model: "anthropic:claude-3-opus",
    created: new Date().toISOString(),
    created_by: "test",
    permitted_tools: [McpToolName.READ_FILE],
  });

  const step = FlowStepSchema.parse({
    id: "step-1",
    name: "Illegal tool",
    identity: "senior-coder",
    execution_mode: FlowStepExecutionMode.DYNAMIC,
    permitted_tools: [McpToolName.READ_FILE],
  });

  llmClient.setDecisions([
    { done: false, tool: McpToolName.WRITE_FILE, args: { path: "hack.ts", content: "..." } },
  ]);

  try {
    await executor.execute(step, identity, "Write something", { traceId: "trace-3" });
    assertEquals(true, false, "Should have thrown");
  } catch (error) {
    assertStringIncludes((error as Error).message, "which is not in permitted_tools");
  }
});

Deno.test("DynamicStepExecutor: filters non-read-only tools from identity", async () => {
  const mcpClient = new MockMcpClient();
  const llmClient = new MockLlmClient();
  const journal = new MockActivityJournal();
  const executor = new DynamicStepExecutor(mcpClient, llmClient, journal);

  const identity = BlueprintFrontmatterSchema.parse({
    identity_id: "senior-coder",
    name: "Senior Coder",
    model: "anthropic:claude-3-opus",
    created: new Date().toISOString(),
    created_by: "test",
    permitted_tools: [McpToolName.READ_FILE, McpToolName.WRITE_FILE], // WRITE is not read-only
  });

  const step = FlowStepSchema.parse({
    id: "step-1",
    name: "Filtered tool",
    identity: "senior-coder",
    execution_mode: FlowStepExecutionMode.DYNAMIC,
  });

  llmClient.setDecisions([
    { done: false, tool: McpToolName.WRITE_FILE, args: {} },
  ]);

  try {
    await executor.execute(step, identity, "Write", { traceId: "trace-4" });
    assertEquals(true, false, "Should have thrown because WRITE was filtered out");
  } catch (error) {
    assertStringIncludes((error as Error).message, "not in permitted_tools");
  }
});

Deno.test("DynamicStepExecutor: throws on non-dynamic step", async () => {
  const mockMcp = new MockMcpClient();
  const mockLlm = new MockLlmClient();
  const mockJournal = new MockActivityJournal();
  const executor = new DynamicStepExecutor(mockMcp, mockLlm, mockJournal);
  const step = FlowStepSchema.parse({
    id: "id",
    name: "Standard",
    identity: "senior-coder",
    execution_mode: FlowStepExecutionMode.DECLARED,
  });

  const identity = BlueprintFrontmatterSchema.parse({
    identity_id: "senior-coder",
    name: "Senior Coder",
    model: "anthropic:claude-3-opus",
    created: new Date().toISOString(),
    created_by: "test",
  });

  try {
    await executor.execute(step, identity, "", {
      traceId: "t",
    });
    assertEquals(true, false, "Should have thrown");
  } catch (error) {
    assertStringIncludes((error as Error).message, "not in dynamic mode");
  }
});
