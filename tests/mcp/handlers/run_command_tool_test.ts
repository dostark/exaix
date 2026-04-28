/**
 * @module RunCommandToolTest
 * @path tests/mcp/handlers/run_command_tool_test.ts
 * @description Unit tests for the RunCommandTool MCP tool.
 */
import { assertEquals, assertStringIncludes } from "@std/assert";
import { RunCommandTool } from "../../../src/mcp/handlers/run_command_tool.ts";
import { initToolPermissionTest } from "../helpers/test_setup.ts";
import { PortalOperation } from "@exaix/core";
import { McpToolName } from "@exaix/mcp";
import { createStubConfig, createStubContext } from "../../helpers/test_helpers.ts";
import { PortalPermissionsService } from "../../../src/services/portal/portal_permissions.ts";
import type { IToolRegistry, IToolResult } from "../../../src/shared/interfaces/i_tool_registry.ts";
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

Deno.test("RunCommandTool: executes a command successfully", async () => {
  const env = await initToolPermissionTest({
    operations: [PortalOperation.GIT], // RunCommand requires GIT or WRITE
  });

  try {
    const mockRegistry = new MockToolRegistry();
    mockRegistry.setResult({ success: true, data: "file1\nfile2" });

    const context = createStubContext({
      config: createStubConfig(env.config),
      toolRegistry: mockRegistry,
    });

    const handler = new RunCommandTool(context, new PortalPermissionsService([env.permissions]));
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
  } finally {
    await env.cleanup();
  }
});

Deno.test("RunCommandTool: throws error if command execution fails in ToolRegistry", async () => {
  const env = await initToolPermissionTest({
    operations: [PortalOperation.GIT],
  });

  try {
    const mockRegistry = new MockToolRegistry();
    mockRegistry.setResult({ success: false, error: "Execution timeout" });

    const context = createStubContext({
      config: createStubConfig(env.config),
      toolRegistry: mockRegistry,
    });

    const handler = new RunCommandTool(context, new PortalPermissionsService([env.permissions]));
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
  } finally {
    await env.cleanup();
  }
});

Deno.test("RunCommandTool: throws error if ToolRegistry is missing from context", async () => {
  const env = await initToolPermissionTest({
    operations: [PortalOperation.GIT],
  });

  try {
    const context = createStubContext({
      config: createStubConfig(env.config),
      toolRegistry: undefined, // Missing
    });

    const handler = new RunCommandTool(context, new PortalPermissionsService([env.permissions]));
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
  } finally {
    await env.cleanup();
  }
});

Deno.test("RunCommandTool: getToolDefinition returns correct definition", () => {
  const context = createStubContext();
  const handler = new RunCommandTool(context);
  const def = handler.getToolDefinition();
  const required = Array.isArray(def.inputSchema.required)
    ? def.inputSchema.required.filter((value): value is string => typeof value === "string")
    : [];

  assertEquals(def.name, McpToolName.RUN_COMMAND);
  assertEquals(required.includes("portal"), true);
  assertEquals(required.includes("command"), true);
});
