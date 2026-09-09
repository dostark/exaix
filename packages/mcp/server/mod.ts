/**
 * @module McpServerPackage
 * @path packages/mcp/server/mod.ts
 * @ungrounded
 * @related-files []
 * @architectural-layer MCP
 * @description Solo-scoped entrypoint for @exaix/mcp/server — exports only
 * LocalToolDispatcher and ToolHandler. Server-only runtime (MCPServer, SseHandler, etc.)
 * moved to @exaix-team/mcp-server (BSL) in Phase 116 Step 5.
 */

export * from "./local_tool_dispatcher.ts";
export * from "./tool_handler.ts";
export { startDogfoodContextServer } from "./dogfood_context_server.ts";
export type {
  IDogfoodContextServerDeps,
  IDogfoodContextServerHandle,
  IDogfoodContextServerMemorySource,
} from "./dogfood_context_server.ts";
