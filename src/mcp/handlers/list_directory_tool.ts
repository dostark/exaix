/**
 * @module ListDirectoryTool
 * @path src/mcp/handlers/list_directory_tool.ts
 * @description Compatibility shim for the package-owned ListDirectoryTool implementation.
 * @architectural-layer MCP
 * @related-files [packages/mcp/server]
 */

import { ListDirectoryTool as ListDirectoryToolBase } from "@exaix/mcp/server";

export class ListDirectoryTool extends ListDirectoryToolBase {}
