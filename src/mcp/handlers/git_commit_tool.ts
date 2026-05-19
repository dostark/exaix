/**
 * @module GitCommitTool
 * @path src/mcp/handlers/git_commit_tool.ts
 * @description Compatibility shim for the package-owned GitCommitTool implementation.
 * @architectural-layer MCP
 * @related-files [packages/mcp/server]
 */

import { GitCommitTool as GitCommitToolBase } from "@exaix/mcp/server";

export class GitCommitTool extends GitCommitToolBase {}
