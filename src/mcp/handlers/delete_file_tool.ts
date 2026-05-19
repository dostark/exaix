/**
 * @module DeleteFileTool
 * @path src/mcp/handlers/delete_file_tool.ts
 * @description Compatibility shim for the package-owned DeleteFileTool implementation.
 * @architectural-layer MCP
 * @related-files [packages/mcp/server]
 */

import { DeleteFileTool as DeleteFileToolBase } from "@exaix/mcp/server";

export class DeleteFileTool extends DeleteFileToolBase {}
