/**
 * @module McpTools
 * @path src/mcp/tools.ts
 * @description Transitional assembly and export module for all MCP tool handlers.
 * Re-exports the canonical tool manifest from @exaix/mcp and provides factory functions
 * that assemble handler maps for the live MCP server and for dynamic execution.
 * MCPServer and FlowRunner should import from this module rather than building handler
 * maps inline. When the server/bootstrap is extracted in Phase 76, this module moves
 * with it.
 * @architectural-layer MCP
 * @related-files [src/mcp/server.ts, src/mcp/tool_handler.ts, packages/mcp/src/manifest.ts]
 */

import { McpToolName, TOOL_MANIFEST, ToolKind } from "@exaix/mcp";
import type { ToolHandler } from "./tool_handler.ts";
import type { ICliApplicationContext } from "../cli/cli_context.ts";
import type { IPortalPermissionsChecker } from "@exaix/schemas/portal_permissions.ts";

import { CreateDirectoryTool } from "./handlers/create_directory_tool.ts";
import { DeleteFileTool } from "./handlers/delete_file_tool.ts";
import { GitCommitTool } from "./handlers/git_commit_tool.ts";
import { GitCreateBranchTool } from "./handlers/git_create_branch_tool.ts";
import { GitStatusTool } from "./handlers/git_status_tool.ts";
import { ListDirectoryTool } from "./handlers/list_directory_tool.ts";
import { MoveFileTool } from "./handlers/move_file_tool.ts";
import { PatchFileTool } from "./handlers/patch_file_tool.ts";
import { ReadFileTool } from "./handlers/read_file_tool.ts";
import { RunCommandTool } from "./handlers/run_command_tool.ts";
import { SearchFilesTool } from "./handlers/search_files_tool.ts";
import { WriteFileTool } from "./handlers/write_file_tool.ts";
import { ApprovePlanTool, CreateRequestTool, ListPlansTool, QueryJournalTool } from "./domain_tools.ts";

interface IMcpToolFactory {
  (context: ICliApplicationContext, permissions: IPortalPermissionsChecker): ToolHandler;
}

const LIVE_MCP_TOOL_KINDS = new Set<ToolKind>([ToolKind.MCP_HANDLER, ToolKind.MCP_DOMAIN]);

export const LIVE_MCP_TOOL_FACTORIES: ReadonlyMap<McpToolName, IMcpToolFactory> = new Map([
  [McpToolName.READ_FILE, (context, permissions) => new ReadFileTool(context, permissions)],
  [McpToolName.WRITE_FILE, (context, permissions) => new WriteFileTool(context, permissions)],
  [McpToolName.PATCH_FILE, (context, permissions) => new PatchFileTool(context, permissions)],
  [McpToolName.DELETE_FILE, (context, permissions) => new DeleteFileTool(context, permissions)],
  [McpToolName.MOVE_FILE, (context, permissions) => new MoveFileTool(context, permissions)],
  [McpToolName.CREATE_DIRECTORY, (context, permissions) => new CreateDirectoryTool(context, permissions)],
  [McpToolName.LIST_DIRECTORY, (context, permissions) => new ListDirectoryTool(context, permissions)],
  [McpToolName.GIT_CREATE_BRANCH, (context, permissions) => new GitCreateBranchTool(context, permissions)],
  [McpToolName.GIT_COMMIT, (context, permissions) => new GitCommitTool(context, permissions)],
  [McpToolName.GIT_STATUS, (context, permissions) => new GitStatusTool(context, permissions)],
  [McpToolName.RUN_COMMAND, (context, permissions) => new RunCommandTool(context, permissions)],
  [McpToolName.SEARCH_FILES, (context, permissions) => new SearchFilesTool(context, permissions)],
  [McpToolName.CREATE_REQUEST, (context, permissions) => new CreateRequestTool(context, permissions)],
  [McpToolName.LIST_PLANS, (context, permissions) => new ListPlansTool(context, permissions)],
  [McpToolName.APPROVE_PLAN, (context, permissions) => new ApprovePlanTool(context, permissions)],
  [McpToolName.QUERY_JOURNAL, (context, permissions) => new QueryJournalTool(context, permissions)],
]);

function liveMcpManifestNames(): McpToolName[] {
  return TOOL_MANIFEST
    .filter((entry) => LIVE_MCP_TOOL_KINDS.has(entry.kind))
    .map((entry) => entry.name as McpToolName);
}

/**
 * Build a handler map for all live MCP tools (mcp_handler + mcp_domain).
 * The permissions parameter will be wired into handlers in Step 77.3 when
 * permission enforcement is made mandatory. It is accepted here now to fix
 * the assembly signature per Decision D8 without requiring callers to change again.
 */
export function buildHandlers(
  context: ICliApplicationContext,
  permissions: IPortalPermissionsChecker,
): Map<McpToolName, ToolHandler> {
  const handlers: Map<McpToolName, ToolHandler> = new Map();

  for (const name of liveMcpManifestNames()) {
    const factory = LIVE_MCP_TOOL_FACTORIES.get(name);
    if (!factory) {
      throw new Error(`Missing MCP tool factory for manifest entry '${name}'`);
    }
    handlers.set(name, factory(context, permissions));
  }

  return handlers;
}

/**
 * Build a handler map for tools safe for dynamic (ReAct-style) execution.
 * Only includes manifest entries where dynamic_mode_allowed === true AND
 * requires_human_approval === false. Per Decision D1, mutating domain tools
 * are excluded here; Phase 79 will upgrade this to a confirmation interceptor.
 */
export function buildDynamicHandlers(
  context: ICliApplicationContext,
  permissions: IPortalPermissionsChecker,
): Map<McpToolName, ToolHandler> {
  const all = buildHandlers(context, permissions);
  const dynamicNames = new Set(
    TOOL_MANIFEST
      .filter((e) => LIVE_MCP_TOOL_KINDS.has(e.kind) && e.dynamic_mode_allowed && !e.requires_human_approval)
      .map((e) => e.name),
  );

  const dynamic: Map<McpToolName, ToolHandler> = new Map();
  for (const [name, handler] of all) {
    if (dynamicNames.has(name)) {
      dynamic.set(name, handler);
    }
  }
  return dynamic;
}
