/**
 * @module McpServer
 * @path src/mcp/server.ts
 * @description Compatibility shim for the package-owned MCP server implementation.
 * @architectural-layer MCP
 * @related-files [packages/mcp/server]
 */

import { MCPServer as MCPServerBase } from "@exaix/mcp/server";

export class MCPServer extends MCPServerBase {}
