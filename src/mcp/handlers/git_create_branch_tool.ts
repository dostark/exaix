/**
 * @module GitCreateBranchTool
 * @path src/mcp/handlers/git_create_branch_tool.ts
 * @description Compatibility shim for the package-owned GitCreateBranchTool implementation.
 * @architectural-layer MCP
 * @related-files [packages/mcp/server]
 */

import { GitCreateBranchTool as GitCreateBranchToolBase } from "@exaix/mcp/server";

export class GitCreateBranchTool extends GitCreateBranchToolBase {}
