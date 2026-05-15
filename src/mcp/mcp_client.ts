/**
 * @module McpClient
 * @path src/mcp/mcp_client.ts
 * @description Wrapper around existing MCP tool execution, providing the IMcpClient interface.
 * @architectural-layer MCP
 * @related-files [src/mcp/tool_handler.ts, src/flows/dynamic_step_executor.ts]
 */
import type { ToolArgs } from "@exaix/ai";
import type { IMcpClient } from "../flows/dynamic_step_executor.ts";
import type { McpToolName } from "@exaix/mcp";
import type { ToolHandler } from "./tool_handler.ts";
import type { IApplicationContext } from "@exaix/core/types";
import type { JSONValue } from "@exaix/core";

export class McpClient implements IMcpClient {
  private readonly tools: Map<string, ToolHandler>;

  constructor(
    private readonly context: IApplicationContext,
    handlers: ToolHandler[] | Map<string, ToolHandler>,
  ) {
    if (handlers instanceof Map) {
      this.tools = new Map(handlers as Map<string, ToolHandler>);
    } else {
      this.tools = new Map<string, ToolHandler>();
      for (const handler of handlers) {
        const def = handler.getToolDefinition();
        this.tools.set(def.name, handler);
      }
    }
  }

  /** Returns the names of all tool handlers registered in this client. */
  getAvailableToolNames(): McpToolName[] {
    return [...this.tools.keys()] as McpToolName[];
  }

  async callTool(tool: McpToolName, args: ToolArgs): Promise<string> {
    const handler = this.tools.get(tool);
    if (!handler) {
      throw new Error(`MCP Tool '${tool}' not found in registry`);
    }

    const response = await handler.execute(args);
    return response.content
      .filter((c) => c.type === "text")
      .map((c) => (c as { type: string; text: string }).text)
      .join("\n");
  }

  getToolDefinitions(tools: McpToolName[]): Array<{
    name: string;
    description: string;
    inputSchema: Record<string, JSONValue>;
  }> {
    return tools
      .map((t) => this.tools.get(t))
      .filter((h): h is ToolHandler => !!h)
      .map((h) => h.getToolDefinition());
  }
}
