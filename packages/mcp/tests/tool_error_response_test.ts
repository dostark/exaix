/**
 * @module ToolErrorResponseTest
 * @path packages/mcp/tests/tool_error_response_test.ts
 * @description Verifies MCP tool handlers return isError:true structured responses instead of throwing for tool-logic errors.
 */
import { assertEquals } from "@std/assert";
import { ToolErrorCode } from "@exaix/core";
import { QueryJournalTool } from "@exaix/mcp/server";
import { RunCommandTool } from "@exaix/mcp/server";
import { createBaseToolContext } from "@exaix/mcp/testing";
import { createStubDb } from "@exaix/testing";
import { createPermissionsService, createToolContext, withToolPermissionTest } from "@exaix/mcp/testing";
import { PortalOperation } from "@exaix/core";
import type { IToolRegistry, IToolResult } from "@exaix/core/types";
import type { JSONValue } from "@exaix/core/types";

class MockFailingRegistry implements IToolRegistry {
  private error: string;

  constructor(error: string) {
    this.error = error;
  }

  getTools() {
    return [];
  }

  execute(_tool: string, _params: Record<string, JSONValue>): Promise<IToolResult> {
    return Promise.resolve({ success: false, error: this.error });
  }
}

Deno.test("RunCommandTool: execution failure returns isError:true response, not thrown exception", async () => {
  await withToolPermissionTest({
    operations: [PortalOperation.GIT],
  }, async (env) => {
    const mockRegistry = new MockFailingRegistry("Execution timeout");
    const handler = new RunCommandTool(
      createToolContext(env, { toolRegistry: mockRegistry }),
      createPermissionsService(env),
    );

    const response = await handler.execute({
      portal: "TestPortal",
      command: "ls",
      args: [],
      identity_id: "test-agent",
    });

    assertEquals(response.isError, true);
    assertEquals(response.content[0].type, "text");
    assertEquals((response.content[0] as { type: "text"; text: string }).text, "Execution timeout");
  });
});

Deno.test("QueryJournalTool: execution failure returns isError:true response, not thrown exception", async () => {
  const handler = new QueryJournalTool(createBaseToolContext({
    db: createStubDb({
      getRecentActivity: () => Promise.reject(new Error("Journal unavailable")),
    }),
  }));

  const response = await handler.execute({
    identity_id: "test-agent",
  });

  assertEquals(response.isError, true);
  assertEquals(response.content[0].type, "text");
  assertEquals((response.content[0] as { type: "text"; text: string }).text, "Journal unavailable");
});

Deno.test("ToolErrorCode: enum values cover required error taxonomy", () => {
  assertEquals(ToolErrorCode.PERMISSION_DENIED, "PERMISSION_DENIED");
  assertEquals(ToolErrorCode.NOT_FOUND, "NOT_FOUND");
  assertEquals(ToolErrorCode.PATH_TRAVERSAL, "PATH_TRAVERSAL");
  assertEquals(ToolErrorCode.INVALID_ARGS, "INVALID_ARGS");
  assertEquals(ToolErrorCode.COMMAND_BLOCKED, "COMMAND_BLOCKED");
  assertEquals(ToolErrorCode.EXECUTION_FAILED, "EXECUTION_FAILED");
});
