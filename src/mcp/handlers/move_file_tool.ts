/**
 * @module MoveFileTool
 * @path src/mcp/handlers/move_file_tool.ts
 * @description Compatibility shim for the package-owned MoveFileTool implementation.
 * @architectural-layer MCP
 * @related-files [packages/mcp/server]
 */

import { MoveFileTool as MoveFileToolBase } from "@exaix/mcp/server";

export class MoveFileTool extends MoveFileToolBase {}
