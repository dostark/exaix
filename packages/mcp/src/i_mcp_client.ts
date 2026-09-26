/**
 * @module IMcpClient
 * @path packages/mcp/src/i_mcp_client.ts
 * @related-files []
 * @architectural-layer MCP
 * @description MCP client interface for tool execution.
 */

import type { McpToolName } from "./enums.ts";
import type { JSONValue } from "@exaix/core";
import type { ToolArgs } from "@exaix/ai";
import type { Opt, Reason } from "@exaix/core/types";

export interface IMcpToolCallContext {
  traceId: string;
  provider?: string;
  model?: string;
}

export interface IMcpClient {
  callTool(
    tool: McpToolName,
    args: ToolArgs,
    context?: Opt<IMcpToolCallContext, Reason.OptionalInput>,
  ): Promise<string>;
  getToolDefinitions(tools: McpToolName[]): Array<{
    name: string;
    description: string;
    inputSchema: Record<string, JSONValue>;
  }>;
}
