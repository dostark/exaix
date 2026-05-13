/**
 * @module RunCommandToolTest
 * @path tests/mcp/handlers/run_command_tool_test.ts
 * @description Unit tests for the RunCommandTool MCP tool.
 */
import { assertEquals, assertStringIncludes } from "@std/assert";
import { RunCommandTool } from "../../../src/mcp/handlers/run_command_tool.ts";
import {
  assertToolDefinitionFields,
  createBaseToolContext,
  createPermissionsService,
  createToolContext,
  withToolPermissionTest,
} from "../helpers/test_setup.ts";
import { PortalOperation } from "@exaix/core";
import { McpToolName } from "@exaix/mcp";
import type { IToolRegistry, IToolResult } from "@exaix/core/types";
import type { JSONValue } from "@exaix/core/types/json.ts";

class MockToolRegistry implements IToolRegistry {
  private result: IToolResult = { success: true };
  private lastArgs: Record<string, JSONValue> = {};

  setResult(result: IToolResult) {
    this.result = result;
  }

  getTools() {
    return [];
  }

  execute(_tool: string, params: Record<string, JSONValue>): Promise<IToolResult> {
    this.lastArgs = params;
    return Promise.resolve(this.result);
  }

  getLastArgs() {
    return this.lastArgs;
  }
}

function createHandler(
  env: Parameters<typeof createToolContext>[0],
  toolRegistry?: IToolRegistry,
): RunCommandTool {
  return new RunCommandTool(
    createToolContext(env, { toolRegistry }),
    createPermissionsService(env),
  );
}

Deno.test("RunCommandTool: executes a command successfully", async () => {
  await withToolPermissionTest({
    operations: [PortalOperation.GIT], // RunCommand requires GIT or WRITE
  }, async (env) => {
    const mockRegistry = new MockToolRegistry();
    mockRegistry.setResult({ success: true, data: "file1\nfile2" });

    const handler = createHandler(env, mockRegistry);
    const result = await handler.execute({
      portal: "TestPortal",
      command: "ls",
      args: ["-la"],
      identity_id: "test-agent",
    });

    assertEquals(result.content[0].type, "text");
    assertStringIncludes(result.content[0].text, "Command executed successfully");

    const lastArgs = mockRegistry.getLastArgs();
    assertEquals(lastArgs.command, "ls");
    assertEquals(Array.isArray(lastArgs.args) && lastArgs.args[0], "-la");
  });
});

Deno.test("RunCommandTool: throws error if command execution fails in ToolRegistry", async () => {
  await withToolPermissionTest({
    operations: [PortalOperation.GIT],
  }, async (env) => {
    const mockRegistry = new MockToolRegistry();
    mockRegistry.setResult({ success: false, error: "Execution timeout" });

    const handler = createHandler(env, mockRegistry);
    try {
      await handler.execute({
        portal: "TestPortal",
        command: "ls",
        identity_id: "test-agent",
      });
      assertEquals(true, false, "Should have thrown");
    } catch (error) {
      assertStringIncludes((error as Error).message, "Execution timeout");
    }
  });
});

Deno.test("RunCommandTool: throws error if ToolRegistry is missing from context", async () => {
  await withToolPermissionTest({
    operations: [PortalOperation.GIT],
  }, async (env) => {
    const handler = createHandler(env);
    try {
      await handler.execute({
        portal: "TestPortal",
        command: "ls",
        identity_id: "test-agent",
      });
      assertEquals(true, false, "Should have thrown");
    } catch (error) {
      assertStringIncludes((error as Error).message, "ToolRegistry not available");
    }
  });
});

Deno.test("RunCommandTool: getToolDefinition returns correct definition", () => {
  const handler = new RunCommandTool(createBaseToolContext());
  assertToolDefinitionFields(handler.getToolDefinition(), McpToolName.RUN_COMMAND, ["portal", "command"]);
});
