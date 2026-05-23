/**
 * @module RunCommandToolTest
 * @path packages/mcp/tests/handlers/run_command_tool_test.ts
 * @related-files []
 * @architectural-layer MCP
 * @description Unit tests for the RunCommandTool MCP tool.
 */
import { assertEquals } from "@std/assert";
import { RunCommandTool } from "@exaix/mcp/server";
import {
  assertToolDefinitionFields,
  createBaseToolContext,
  createPermissionsService,
  createToolContext,
  withToolPermissionTest,
} from "@exaix/mcp/testing";
import { PortalOperation } from "@exaix/core";
import { McpToolName } from "@exaix/mcp";
import type { IToolRegistry, IToolResult } from "@exaix/core/types";
import type { JSONValue } from "@exaix/core/types";

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

Deno.test("RunCommandTool: actual command output appears in MCP response content", async () => {
  await withToolPermissionTest({
    operations: [PortalOperation.GIT],
  }, async (env) => {
    const mockRegistry = new MockToolRegistry();
    mockRegistry.setResult({ success: true, data: { output: "file1\nfile2\n", exitCode: 0 } });

    const handler = createHandler(env, mockRegistry);
    const result = await handler.execute({
      portal: "TestPortal",
      command: "ls",
      args: ["-1"],
      identity_id: "test-agent",
    });

    assertEquals(result.content[0].type, "exaix_structured_data");
    const block = result.content[0] as { type: "exaix_structured_data"; data: { output: string; exitCode: number } };
    assertEquals(block.data.output.includes("file1"), true);
    assertEquals(block.data.output.includes("file2"), true);
    assertEquals(block.data.exitCode, 0);

    const lastArgs = mockRegistry.getLastArgs();
    assertEquals(lastArgs.command, "ls");
    assertEquals(Array.isArray(lastArgs.args) && lastArgs.args[0], "-1");
  });
});

Deno.test("RunCommandTool: execution failure returns isError:true response, not thrown exception", async () => {
  await withToolPermissionTest({
    operations: [PortalOperation.GIT],
  }, async (env) => {
    const mockRegistry = new MockToolRegistry();
    mockRegistry.setResult({ success: false, error: "Execution timeout" });

    const handler = createHandler(env, mockRegistry);
    const result = await handler.execute({
      portal: "TestPortal",
      command: "ls",
      identity_id: "test-agent",
    });

    assertEquals(result.isError, true);
    assertEquals(result.content[0].type, "text");
    assertEquals((result.content[0] as { type: "text"; text: string }).text, "Execution timeout");
  });
});

Deno.test("RunCommandTool: missing ToolRegistry returns isError:true response", async () => {
  await withToolPermissionTest({
    operations: [PortalOperation.GIT],
  }, async (env) => {
    const handler = createHandler(env);
    const result = await handler.execute({
      portal: "TestPortal",
      command: "ls",
      identity_id: "test-agent",
    });

    assertEquals(result.isError, true);
    assertEquals(result.content[0].type, "text");
    assertEquals(
      (result.content[0] as { type: "text"; text: string }).text.includes("ToolRegistry"),
      true,
    );
  });
});

Deno.test("RunCommandTool: getToolDefinition returns correct definition", () => {
  const handler = new RunCommandTool(createBaseToolContext());
  assertToolDefinitionFields(handler.getToolDefinition(), McpToolName.RUN_COMMAND, ["portal", "command"]);
});
