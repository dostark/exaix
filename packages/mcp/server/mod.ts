/**
 * @module McpServerPackage
 * @path packages/mcp/server/mod.ts
 * @ungrounded
 * @related-files []
 * @architectural-layer MCP
 * @description MIT-scoped entrypoint for @exaix/mcp/server — exports only
 * McpClient and ToolHandler. Server-only runtime (MCPServer, SseHandler, etc.)
 * moved to @exaix-team/mcp-server (BSL) in Phase 116 Step 5.
 */

export * from "./mcp_client.ts";
export * from "./tool_handler.ts";
