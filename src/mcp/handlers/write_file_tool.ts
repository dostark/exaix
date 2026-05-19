/**
 * @module WriteFileTool
 * @path src/mcp/handlers/write_file_tool.ts
 * @description Compatibility shim for the package-owned WriteFileTool implementation.
 * @architectural-layer MCP
 * @related-files [packages/mcp/server]
 */

import { WriteFileTool as WriteFileToolBase } from "@exaix/mcp/server";

export class WriteFileTool extends WriteFileToolBase {}
