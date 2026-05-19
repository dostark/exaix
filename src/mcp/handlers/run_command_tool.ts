/**
 * @module RunCommandTool
 * @path src/mcp/handlers/run_command_tool.ts
 * @description Compatibility shim for the package-owned RunCommandTool implementation.
 * @architectural-layer MCP
 * @related-files [packages/mcp/server]
 */

import { RunCommandTool as RunCommandToolBase } from "@exaix/mcp/server";

export class RunCommandTool extends RunCommandToolBase {}
