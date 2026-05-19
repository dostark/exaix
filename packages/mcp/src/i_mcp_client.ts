/**
 * @module IMcpClient
 * @path packages/mcp/src/i_mcp_client.ts
 * @description MCP client interface for tool execution.
 */

import type { McpToolName } from "./enums.ts";
import type { JSONValue } from "@exaix/core";
import type { ToolArgs } from "@exaix/ai";

export interface IMcpClient {
  callTool(tool: McpToolName, args: ToolArgs): Promise<string>;
  getToolDefinitions(tools: McpToolName[]): Array<{
    name: string;
    description: string;
    inputSchema: Record<string, JSONValue>;
  }>;
}
