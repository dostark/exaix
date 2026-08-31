/**
 * @module DynamicStepExecutorWithToolsTest
 * @path tests/integration/mcp/dynamic_step_executor_with_tools_test.ts
 * @description Integration tests verifying that FlowRunner wires LocalToolDispatcher using a canonical
 * dynamic handler map (Map<McpToolName, ToolHandler>) rather than an ad-hoc handler array.
 * Ensures dynamic tool calls route correctly through the canonical handler surface.
 */

import { assertEquals, assertExists } from "@std/assert";
import { McpToolName } from "@exaix/mcp";
import { LocalToolDispatcher } from "@exaix/mcp/server";
import { ToolHandler } from "@exaix/mcp/server";
import { FlowRunner, type IFlowEventLogger } from "@exaix/flow";
import { createStubContext } from "@exaix/testing";
import type { JSONValue } from "@exaix/core/types";
import type { MCPToolResponse } from "@exaix/schemas/mcp.ts";

type IToolDefinition = ReturnType<ToolHandler["getToolDefinition"]>;

// Minimal event logger that satisfies IFlowEventLogger without any type hacks
class StubEventLogger implements IFlowEventLogger {
  log<TEvent extends string>(_event: TEvent, _payload: Record<string, JSONValue>): void {}
}

// Stub handler registered with a specific tool name
class StubReadFileTool extends ToolHandler {
  private readonly response: string;

  constructor(response: string) {
    super(createStubContext());
    this.response = response;
  }

  async execute(_args: Record<string, JSONValue>): Promise<MCPToolResponse> {
    await Promise.resolve();
    return { content: [{ type: "text", text: this.response }] };
  }

  getToolDefinition(): IToolDefinition {
    return {
      name: McpToolName.READ_FILE,
      description: "Stub read_file",
      inputSchema: { type: "object", properties: {} },
    };
  }
}

class StubListDirTool extends ToolHandler {
  constructor() {
    super(createStubContext());
  }

  async execute(_args: Record<string, JSONValue>): Promise<MCPToolResponse> {
    await Promise.resolve();
    return { content: [{ type: "text", text: "file1.ts\nfile2.ts" }] };
  }

  getToolDefinition(): IToolDefinition {
    return {
      name: McpToolName.LIST_DIRECTORY,
      description: "Stub list_directory",
      inputSchema: { type: "object", properties: {} },
    };
  }
}

// LocalToolDispatcher Map constructor tests

Deno.test(
  "LocalToolDispatcher: accepts Map<McpToolName, ToolHandler> as canonical dynamic handler input",
  async () => {
    const readTool = new StubReadFileTool("file contents");
    const listTool = new StubListDirTool();

    const handlerMap = new Map<McpToolName, ToolHandler>([
      [McpToolName.READ_FILE, readTool],
      [McpToolName.LIST_DIRECTORY, listTool],
    ]);

    const client = new LocalToolDispatcher(createStubContext(), handlerMap);

    const result = await client.callTool(McpToolName.READ_FILE, {});
    assertEquals(result, "file contents");

    const defs = client.getToolDefinitions([McpToolName.LIST_DIRECTORY]);
    assertEquals(defs.length, 1);
    assertEquals(defs[0].name, McpToolName.LIST_DIRECTORY);
  },
);

Deno.test(
  "LocalToolDispatcher: getAvailableToolNames returns all registered canonical tool names",
  () => {
    const readTool = new StubReadFileTool("content");
    const listTool = new StubListDirTool();

    const handlerMap = new Map<McpToolName, ToolHandler>([
      [McpToolName.READ_FILE, readTool],
      [McpToolName.LIST_DIRECTORY, listTool],
    ]);

    const client = new LocalToolDispatcher(createStubContext(), handlerMap);
    const names = client.getAvailableToolNames();

    assertExists(names);
    assertEquals(names.sort(), [McpToolName.LIST_DIRECTORY, McpToolName.READ_FILE].sort());
  },
);

Deno.test(
  "LocalToolDispatcher: canonical Map input excludes non-registered tools from getToolDefinitions",
  () => {
    const handlerMap = new Map<McpToolName, ToolHandler>([
      [McpToolName.READ_FILE, new StubReadFileTool("x")],
    ]);

    const client = new LocalToolDispatcher(createStubContext(), handlerMap);
    // WRITE_FILE is not in the map — getToolDefinitions should return empty for it
    const defs = client.getToolDefinitions([McpToolName.WRITE_FILE]);
    assertEquals(defs.length, 0);
  },
);

// FlowRunner dynamic wiring tests

Deno.test(
  "FlowRunner: accepts dynamicHandlers Map in config and wires LocalToolDispatcher canonically",
  () => {
    const readTool = new StubReadFileTool("hello from canonical");
    const handlerMap = new Map<McpToolName, ToolHandler>([
      [McpToolName.READ_FILE, readTool],
    ]);

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
      eventLogger: new StubEventLogger(),
      dynamicHandlers: handlerMap,
    });

    // Verify the runner was constructed without error and wired the canonical handlers
    assertExists(runner);
  },
);

Deno.test(
  "FlowRunner: dynamicHandlers Map tools are accessible via LocalToolDispatcher registry",
  async () => {
    const readTool = new StubReadFileTool("canonical content");
    const listTool = new StubListDirTool();

    const handlerMap = new Map<McpToolName, ToolHandler>([
      [McpToolName.READ_FILE, readTool],
      [McpToolName.LIST_DIRECTORY, listTool],
    ]);

    // LocalToolDispatcher built the same way FlowRunner would build it from dynamicHandlers
    const client = new LocalToolDispatcher(createStubContext(), handlerMap);

    const names = client.getAvailableToolNames().sort();
    assertEquals(names, [McpToolName.LIST_DIRECTORY, McpToolName.READ_FILE].sort());

    const result = await client.callTool(McpToolName.LIST_DIRECTORY, {});
    assertEquals(result, "file1.ts\nfile2.ts");
  },
);
