/**
 * @module GitStatusTool
 * @path src/mcp/handlers/git_status_tool.ts
 * @description Compatibility shim for the package-owned GitStatusTool implementation.
 * @architectural-layer MCP
 * @related-files [packages/mcp/server]
 */

import { GitStatusTool as GitStatusToolBase } from "@exaix/mcp/server";

export class GitStatusTool extends GitStatusToolBase {}
