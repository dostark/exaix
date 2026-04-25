/**
 * @module McpConstants
 * @path packages/mcp/src/constants.ts
 * @description MCP-specific defaults and tool metadata exported by @exaix/mcp.
 */

import { McpToolName, McpTransportType } from "./enums.ts";

export const DEFAULT_MCP_ENABLED = true;
export const DEFAULT_MCP_TRANSPORT = McpTransportType.STDIO;
export const DEFAULT_MCP_SERVER_NAME = "exaix";
export const DEFAULT_MCP_VERSION = "1.0.0";
export const DEFAULT_MCP_IDENTITY_ID = "system";
export const DEFAULT_MCP_HTTP_PORT = 3000;

export const READ_ONLY_TOOLS: ReadonlySet<McpToolName> = new Set([
  McpToolName.READ_FILE,
  McpToolName.LIST_DIRECTORY,
  McpToolName.SEARCH_FILES,
  McpToolName.GIT_STATUS,
  McpToolName.LIST_PLANS,
  McpToolName.QUERY_JOURNAL,
  McpToolName.FETCH_URL,
]);

export const WRITE_TOOLS: ReadonlySet<McpToolName> = new Set([
  McpToolName.WRITE_FILE,
  McpToolName.PATCH_FILE,
  McpToolName.DELETE_FILE,
  McpToolName.MOVE_FILE,
  McpToolName.CREATE_DIRECTORY,
  McpToolName.GIT_CREATE_BRANCH,
  McpToolName.GIT_COMMIT,
  McpToolName.RUN_COMMAND,
  McpToolName.CREATE_REQUEST,
  McpToolName.APPROVE_PLAN,
  McpToolName.GIT,
]);

export const TOTAL_MCP_TOOLS = READ_ONLY_TOOLS.size + WRITE_TOOLS.size;
