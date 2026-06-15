/**
 * @module ToolResultConverter
 * @path packages/mcp/src/tool_result_converter.ts
 * @description Canonical IToolResult → MCPToolResponse conversion for registry-delegating MCP handlers.
 * @architectural-layer MCP
 * @ungrounded
 * @package @exaix/mcp
 * @dependencies [@exaix/schemas/mcp.ts, @exaix/core/types]
 * @related-files [packages/mcp/src/tool_result_metadata.ts, packages/mcp/server/tool_handler.ts, packages-team/mcp-server/handlers/run_command_tool.ts, packages-team/mcp-server/handlers/search_files_tool.ts]
 */
import type { MCPToolResponse } from "@exaix/schemas";

import { MCP_CONTENT_TYPE_STRUCTURED_DATA } from "@exaix/core";
import type { IToolResult } from "@exaix/core/types";

/**
 * Maps an IToolResult to an MCPToolResponse using the canonical content model:
 * - error results → isError: true with text content block
 * - success with string data → text content block
 * - success with object/array data → exaix_structured_data content block
 * - success with no data → empty text content block
 */
export function toolResultToMcpResponse(result: IToolResult): MCPToolResponse {
  if (!result.success) {
    return {
      content: [{ type: "text", text: result.error ?? "Unknown error" }],
      isError: true,
    };
  }

  const { data } = result;

  if (data === undefined || data === null) {
    return { content: [{ type: "text", text: "" }] };
  }

  if (typeof data === "string") {
    return { content: [{ type: "text", text: data }] };
  }

  return { content: [{ type: MCP_CONTENT_TYPE_STRUCTURED_DATA, data }] };
}
