/**
 * @module ReadFileTool
 * @path src/mcp/handlers/read_file_tool.ts
 * @description Compatibility shim for the package-owned ReadFileTool implementation.
 * @architectural-layer MCP
 * @related-files [packages/mcp/server]
 */

import { ReadFileTool as ReadFileToolBase } from "@exaix/mcp/server";

export class ReadFileTool extends ReadFileToolBase {}
