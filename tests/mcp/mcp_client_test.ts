/**
 * @module McpClientTest
 * @path tests/mcp/mcp_client_test.ts
 * @description Unit tests for McpClient tool routing and canonical Map-based construction.
 */
import { assertEquals, assertExists, assertRejects } from "@std/assert";
import { McpClient } from "@exaix/mcp/server";
import { McpToolName } from "@exaix/mcp";
import { ToolHandler } from "@exaix/mcp/server";
import type { ICliApplicationContext } from "../../src/cli/cli_context.ts";
import type { JSONValue } from "@exaix/core/types";
import type { MCPToolResponse } from "@exaix/schemas/mcp.ts";
import { createStubContext } from "../helpers/test_helpers.ts";

type IToolDefinition = ReturnType<ToolHandler["getToolDefinition"]>;

const mockContext: ICliApplicationContext = createStubContext({
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

Deno.test("McpClient - calls existing MCP tools correctly", async () => {
  const handlers = [new PassingTool()];
  const client = new McpClient(mockContext, handlers);

  const result = await client.callTool(McpToolName.READ_FILE, {});
  assertEquals(result, "success_result");
});

Deno.test("McpClient - tool not found propagating error", async () => {
  const client = new McpClient(mockContext, []);

  await assertRejects(
    () => client.callTool(McpToolName.READ_FILE, {}),
    Error,
    "not found",
  );
});

Deno.test("McpClient - tool execution errors are propagated", async () => {
  const client = new McpClient(mockContext, [new FailingTool()]);

  await assertRejects(
    () => client.callTool(McpToolName.WRITE_FILE, {}),
    Error,
    "execution error",
  );
});

Deno.test("McpClient - accepts Map<McpToolName, ToolHandler> as canonical input", async () => {
  const handlerMap = new Map<McpToolName, ToolHandler>([
    [McpToolName.READ_FILE, new PassingTool()],
  ]);
  const client = new McpClient(mockContext, handlerMap);

  const result = await client.callTool(McpToolName.READ_FILE, {});
  assertEquals(result, "success_result");
});

Deno.test("McpClient - getAvailableToolNames returns all registered tool names", () => {
  const handlerMap = new Map<McpToolName, ToolHandler>([
    [McpToolName.READ_FILE, new PassingTool()],
    [McpToolName.WRITE_FILE, new FailingTool()],
  ]);
  const client = new McpClient(mockContext, handlerMap);

  const names = client.getAvailableToolNames();
  assertExists(names);
  assertEquals(names.sort(), [McpToolName.READ_FILE, McpToolName.WRITE_FILE].sort());
});

Deno.test("McpClient - getAvailableToolNames returns empty for empty client", () => {
  const client = new McpClient(mockContext, []);
  assertEquals(client.getAvailableToolNames(), []);
});

// ── IToolManifestResolver (Phase 79) ─────────────────────────────────────────

Deno.test("McpClient - requiresHumanApproval returns true for exaix_create_request", () => {
  const client = new McpClient(mockContext, []);
  assertEquals(client.requiresHumanApproval(McpToolName.CREATE_REQUEST), true);
});

Deno.test("McpClient - requiresHumanApproval returns true for exaix_approve_plan", () => {
  const client = new McpClient(mockContext, []);
  assertEquals(client.requiresHumanApproval(McpToolName.APPROVE_PLAN), true);
});

Deno.test("McpClient - requiresHumanApproval returns false for read_file", () => {
  const client = new McpClient(mockContext, []);
  assertEquals(client.requiresHumanApproval(McpToolName.READ_FILE), false);
});

Deno.test("McpClient - requiresHumanApproval returns false for unknown tool name", () => {
  const client = new McpClient(mockContext, []);
  assertEquals(client.requiresHumanApproval("unknown_tool" as McpToolName), false);
});

Deno.test("McpClient - Map construction: tool not in map returns not found error", async () => {
  const handlerMap = new Map<McpToolName, ToolHandler>([
    [McpToolName.READ_FILE, new PassingTool()],
  ]);
  const client = new McpClient(mockContext, handlerMap);

  await assertRejects(
    () => client.callTool(McpToolName.LIST_DIRECTORY, {}),
    Error,
    "not found",
  );
});
