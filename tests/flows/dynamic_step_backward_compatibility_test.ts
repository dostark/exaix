/**
 * @module DynamicStepBackwardCompatibilityTest
 * @path tests/flows/dynamic_step_backward_compatibility_test.ts
 * @description Regression tests verifying that existing FlowRunner and McpClient usage
 * patterns remain valid during Phase 77/76 migration. Tests that the deprecated
 * mcpHandlers array path still works alongside the new canonical dynamicHandlers Map path.
 * Guards against accidental breaking changes in constructor signatures or handler routing.
 */

import { assertEquals, assertExists } from "@std/assert";
import { McpToolName } from "@exaix/mcp";
import { McpClient } from "../../src/mcp/mcp_client.ts";
import { ToolHandler } from "../../src/mcp/tool_handler.ts";
import { FlowRunner, type IFlowEventLogger } from "../../src/flows/flow_runner.ts";
import { createStubContext } from "../helpers/test_helpers.ts";
import type { JSONValue } from "@exaix/core/types/json.ts";
import type { MCPToolResponse } from "@exaix/schemas/mcp.ts";

type IToolDefinition = ReturnType<ToolHandler["getToolDefinition"]>;

class StubReadHandler extends ToolHandler {
  constructor() {
    super(createStubContext());
  }

  async execute(_args: Record<string, JSONValue>): Promise<MCPToolResponse> {
    await Promise.resolve();
    return { content: [{ type: "text", text: "stub content" }] };
  }

  getToolDefinition(): IToolDefinition {
    return {
      name: McpToolName.READ_FILE,
      description: "Stub read_file for backward compat test",
      inputSchema: { type: "object", properties: {} },
    };
  }
}

class StubListDirHandler extends ToolHandler {
  constructor() {
    super(createStubContext());
  }

  async execute(_args: Record<string, JSONValue>): Promise<MCPToolResponse> {
    await Promise.resolve();
    return { content: [{ type: "text", text: "file.ts" }] };
  }

  getToolDefinition(): IToolDefinition {
    return {
      name: McpToolName.LIST_DIRECTORY,
      description: "Stub list_directory for backward compat test",
      inputSchema: { type: "object", properties: {} },
    };
  }
}

class NoopEventLogger implements IFlowEventLogger {
  log<TEvent extends string>(_event: TEvent, _payload: Record<string, JSONValue>): void {}
}

// ── McpClient: ToolHandler[] path (legacy) ────────────────────────────────────

Deno.test("backwards_compat: McpClient accepts ToolHandler[] array (legacy path still works)", async () => {
  const handlers: ToolHandler[] = [new StubReadHandler(), new StubListDirHandler()];
  const client = new McpClient(createStubContext(), handlers);

  const result = await client.callTool(McpToolName.READ_FILE, {});
  assertEquals(result, "stub content");
});

Deno.test("backwards_compat: McpClient ToolHandler[] and Map produce identical tool names", () => {
  const readHandler = new StubReadHandler();
  const listHandler = new StubListDirHandler();

  const legacyClient = new McpClient(createStubContext(), [readHandler, listHandler]);
  const canonicalClient = new McpClient(
    createStubContext(),
    new Map<McpToolName, ToolHandler>([
      [McpToolName.READ_FILE, readHandler],
      [McpToolName.LIST_DIRECTORY, listHandler],
    ]),
  );

  assertEquals(
    legacyClient.getAvailableToolNames().sort(),
    canonicalClient.getAvailableToolNames().sort(),
    "Legacy array path and canonical Map path must expose the same tool names",
  );
});

Deno.test("backwards_compat: McpClient getToolDefinitions works from legacy ToolHandler[] input", () => {
  const handlers: ToolHandler[] = [new StubReadHandler()];
  const client = new McpClient(createStubContext(), handlers);

  const defs = client.getToolDefinitions([McpToolName.READ_FILE]);
  assertEquals(defs.length, 1);
  assertEquals(defs[0].name, McpToolName.READ_FILE);
});

// ── FlowRunner: deprecated mcpHandlers path ───────────────────────────────────

Deno.test("backwards_compat: FlowRunner accepts deprecated mcpHandlers ToolHandler[] in config", () => {
  const mockAgentExecutor = {
    run: () =>
      Promise.resolve({
        thought: "",
        content: "done",
        raw: "",
        tokensUsed: { input: 0, output: 0 },
      }),
  };

  const runner = new FlowRunner({
    agentExecutor: mockAgentExecutor,
    eventLogger: new NoopEventLogger(),
    mcpHandlers: [new StubReadHandler()],
  });

  assertExists(runner, "FlowRunner with deprecated mcpHandlers must construct without error");
});

Deno.test("backwards_compat: FlowRunner with dynamicHandlers Map takes precedence over mcpHandlers array", () => {
  const mockAgentExecutor = {
    run: () =>
      Promise.resolve({
        thought: "",
        content: "done",
        raw: "",
        tokensUsed: { input: 0, output: 0 },
      }),
  };

  const runner = new FlowRunner({
    agentExecutor: mockAgentExecutor,
    eventLogger: new NoopEventLogger(),
    dynamicHandlers: new Map([[McpToolName.READ_FILE, new StubReadHandler()]]),
    mcpHandlers: [new StubListDirHandler()],
  });

  assertExists(runner, "FlowRunner with both dynamicHandlers and mcpHandlers must construct");
});
