/**
 * @module LocalToolDispatcherTest
 * @path packages/mcp/tests/local_tool_dispatcher_test.ts
 * @related-files []
 * @architectural-layer MCP
 * @description Unit tests for LocalToolDispatcher tool routing and canonical Map-based construction.
 */
import { assertEquals, assertExists, assertRejects } from "@std/assert";
import { LocalToolDispatcher } from "@exaix/mcp/server";
import { appendToolChoiceHint, McpToolName } from "@exaix/mcp";
import { ToolHandler } from "@exaix/mcp/server";
import type { IApplicationContext } from "@exaix/core/types";
import type { JSONValue } from "@exaix/core/types";
import type { MCPToolResponse } from "@exaix/schemas/mcp.ts";
import { createStubContext } from "@exaix/testing";

type IToolDefinition = ReturnType<ToolHandler["getToolDefinition"]>;

const mockContext: IApplicationContext = createStubContext({
  db: {
    logActivity: (
      _actor: string,
      _action: string,
      _target: string | null,
      _payload: Record<string, JSONValue>,
      _traceId?: string,
      _identityId?: string | null,
    ) => {},
    waitForFlush: () => Promise.resolve(),
    queryActivity: () => Promise.resolve([]),
    getActivitiesByTrace: () => [],
    getActivitiesByTraceSafe: () => Promise.resolve([]),
    getActivitiesByActionType: () => [],
    getActivitiesByActionTypeSafe: () => Promise.resolve([]),
    getRecentActivity: () => Promise.resolve([]),
    insertToolConfirmationRequest: () => Promise.resolve(),
    writeToolConfirmationDecision: () => Promise.resolve(),
    getToolConfirmationDecision: () => Promise.resolve(null),
    listPendingToolConfirmations: () => Promise.resolve([]),
    close: () => Promise.resolve(),
    preparedGet: () => Promise.resolve(null),
    preparedAll: () => Promise.resolve([]),
    preparedRun: () => Promise.resolve({}),
  },
});

class PassingTool extends ToolHandler {
  constructor() {
    super(mockContext);
  }
  async execute(_args: Record<string, JSONValue>): Promise<MCPToolResponse> {
    await Promise.resolve();
    return { content: [{ type: "text", text: "success_result" }] };
  }
  getToolDefinition(): IToolDefinition {
    return { name: McpToolName.READ_FILE, description: "", inputSchema: { type: "object", properties: {} } };
  }
}

class FailingTool extends ToolHandler {
  constructor() {
    super(mockContext);
  }
  async execute(_args: Record<string, JSONValue>): Promise<MCPToolResponse> {
    await Promise.resolve();
    throw new Error("execution error");
  }
  getToolDefinition(): IToolDefinition {
    return { name: McpToolName.WRITE_FILE, description: "", inputSchema: { type: "object", properties: {} } };
  }
}

Deno.test("LocalToolDispatcher - calls existing MCP tools correctly", async () => {
  const handlers = [new PassingTool()];
  const client = new LocalToolDispatcher(mockContext, handlers);

  const result = await client.callTool(McpToolName.READ_FILE, {});
  assertEquals(result, "success_result");
});

Deno.test("LocalToolDispatcher - tool not found propagating error", async () => {
  const client = new LocalToolDispatcher(mockContext, []);

  await assertRejects(
    () => client.callTool(McpToolName.READ_FILE, {}),
    Error,
    "not found",
  );
});

Deno.test("LocalToolDispatcher - tool execution errors are propagated", async () => {
  const client = new LocalToolDispatcher(mockContext, [new FailingTool()]);

  await assertRejects(
    () => client.callTool(McpToolName.WRITE_FILE, {}),
    Error,
    "execution error",
  );
});

Deno.test("LocalToolDispatcher - accepts Map<McpToolName, ToolHandler> as canonical input", async () => {
  const handlerMap = new Map<McpToolName, ToolHandler>([
    [McpToolName.READ_FILE, new PassingTool()],
  ]);
  const client = new LocalToolDispatcher(mockContext, handlerMap);

  const result = await client.callTool(McpToolName.READ_FILE, {});
  assertEquals(result, "success_result");
});

Deno.test("LocalToolDispatcher - getAvailableToolNames returns all registered tool names", () => {
  const handlerMap = new Map<McpToolName, ToolHandler>([
    [McpToolName.READ_FILE, new PassingTool()],
    [McpToolName.WRITE_FILE, new FailingTool()],
  ]);
  const client = new LocalToolDispatcher(mockContext, handlerMap);

  const names = client.getAvailableToolNames();
  assertExists(names);
  assertEquals(names.sort(), [McpToolName.READ_FILE, McpToolName.WRITE_FILE].sort());
});

Deno.test("LocalToolDispatcher - getAvailableToolNames returns empty for empty client", () => {
  const client = new LocalToolDispatcher(mockContext, []);
  assertEquals(client.getAvailableToolNames(), []);
});

// IToolManifestResolver

Deno.test("LocalToolDispatcher - requiresHumanApproval returns true for exaix_create_request", () => {
  const client = new LocalToolDispatcher(mockContext, []);
  assertEquals(client.requiresHumanApproval(McpToolName.CREATE_REQUEST), true);
});

Deno.test("LocalToolDispatcher - requiresHumanApproval returns true for exaix_approve_plan", () => {
  const client = new LocalToolDispatcher(mockContext, []);
  assertEquals(client.requiresHumanApproval(McpToolName.APPROVE_PLAN), true);
});

Deno.test("LocalToolDispatcher - requiresHumanApproval returns false for read_file", () => {
  const client = new LocalToolDispatcher(mockContext, []);
  assertEquals(client.requiresHumanApproval(McpToolName.READ_FILE), false);
});

Deno.test("LocalToolDispatcher - requiresHumanApproval returns false for unknown tool name", () => {
  const client = new LocalToolDispatcher(mockContext, []);
  assertEquals(client.requiresHumanApproval("unknown_tool" as McpToolName), false);
});

Deno.test("LocalToolDispatcher - getToolDefinitions appends the manifest hint to a tool's description", () => {
  class StubPatchFileTool extends ToolHandler {
    constructor() {
      super(mockContext);
    }
    execute(): Promise<MCPToolResponse> {
      return Promise.resolve({ content: [] });
    }
    getToolDefinition(): IToolDefinition {
      return {
        name: McpToolName.PATCH_FILE,
        description: "Base description.",
        inputSchema: { type: "object", properties: {} },
      };
    }
  }
  const client = new LocalToolDispatcher(mockContext, [new StubPatchFileTool()]);
  const [definition] = client.getToolDefinitions([McpToolName.PATCH_FILE]);
  assertEquals(definition.description, appendToolChoiceHint(McpToolName.PATCH_FILE, "Base description."));
});

Deno.test("LocalToolDispatcher - Map construction: tool not in map returns not found error", async () => {
  const handlerMap = new Map<McpToolName, ToolHandler>([
    [McpToolName.READ_FILE, new PassingTool()],
  ]);
  const client = new LocalToolDispatcher(mockContext, handlerMap);

  await assertRejects(
    () => client.callTool(McpToolName.LIST_DIRECTORY, {}),
    Error,
    "not found",
  );
});
