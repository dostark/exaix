/**
 * @module ToolHandler
 * @path src/mcp/tool_handler.ts
 * @description Compatibility shim for the package-owned base MCP tool handler.
 * @architectural-layer MCP
 * @related-files [packages/mcp/server]
 */

import { ToolHandler as ToolHandlerBase } from "@exaix/mcp/server";

export abstract class ToolHandler extends ToolHandlerBase {}
