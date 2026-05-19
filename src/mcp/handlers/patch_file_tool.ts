/**
 * @module PatchFileTool
 * @path src/mcp/handlers/patch_file_tool.ts
 * @description Compatibility shim for the package-owned PatchFileTool implementation.
 * @architectural-layer MCP
 * @related-files [packages/mcp/server]
 */

import { PatchFileTool as PatchFileToolBase } from "@exaix/mcp/server";

export class PatchFileTool extends PatchFileToolBase {}
