/**
 * @module McpClient
 * @path src/mcp/mcp_client.ts
 * @description Compatibility shim for the package-owned MCP client wrapper.
 * @architectural-layer MCP
 * @related-files [packages/mcp/server]
 */

import { McpClient as McpClientBase } from "@exaix/mcp/server";

export class McpClient extends McpClientBase {}
