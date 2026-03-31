/**
 * @module McpClient
 * @path src/mcp/mcp_client.ts
 * @description Wrapper around existing MCP tool execution, providing the IMcpClient interface.
 * @architectural-layer MCP
 * * @related-files [src/mcp/tool_handler.ts, src/flows/dynamic_step_executor.ts]
 */
import { IMcpClient, ToolArgs } from "../flows/dynamic_step_executor.ts";
import { McpToolName } from "../shared/enums.ts";
import { ToolHandler } from "./tool_handler.ts";
import { ICliApplicationContext } from "../cli/cli_context.ts";
import { JSONValue } from "../shared/types/json.ts";

export class McpClient implements IMcpClient {
  private readonly tools = new Map<string, ToolHandler>();

  constructor(
    private readonly context: ICliApplicationContext,
    handlers: ToolHandler[],
  ) {
    for (const handler of handlers) {
      const def = handler.getToolDefinition();
      this.tools.set(def.name, handler);
    }
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
