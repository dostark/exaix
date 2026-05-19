/**
 * @module CreateDirectoryTool
 * @path src/mcp/handlers/create_directory_tool.ts
 * @description Compatibility shim for the package-owned CreateDirectoryTool implementation.
 * @architectural-layer MCP
 * @related-files [packages/mcp/server]
 */

import { CreateDirectoryTool as CreateDirectoryToolBase } from "@exaix/mcp/server";

export class CreateDirectoryTool extends CreateDirectoryToolBase {}
