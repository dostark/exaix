/**
 * @module McpClientTest
 * @path tests/mcp/mcp_client_test.ts
 * @description Unit tests for McpClient tool routing.
 */
import { assertEquals, assertRejects } from "@std/assert";
import { McpClient } from "../../src/mcp/mcp_client.ts";
import { McpToolName } from "../../src/shared/enums.ts";
import { ToolHandler } from "../../src/mcp/tool_handler.ts";
import type { ICliApplicationContext } from "../../src/cli/cli_context.ts";
import type { JSONValue } from "../../src/shared/types/json.ts";
import type { MCPToolResponse } from "../../src/shared/schemas/mcp.ts";
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
