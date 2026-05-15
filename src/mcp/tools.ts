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

import type { McpToolName } from "@exaix/mcp";
import { TOOL_MANIFEST, ToolKind } from "@exaix/mcp";
import type { ToolHandler } from "./tool_handler.ts";
import type { ICliApplicationContext } from "../cli/cli_context.ts";
import type { PortalPermissionsService } from "../services/portal/portal_permissions.ts";

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

/**
 * Build a handler map for all live MCP tools (mcp_handler + mcp_domain).
 * The permissions parameter will be wired into handlers in Step 77.3 when
 * permission enforcement is made mandatory. It is accepted here now to fix
 * the assembly signature per Decision D8 without requiring callers to change again.
 */
export function buildHandlers(
  context: ICliApplicationContext,
  _permissions: PortalPermissionsService,
): Map<McpToolName, ToolHandler> {
  const handlers: Map<McpToolName, ToolHandler> = new Map();

  const add = (handler: ToolHandler) => {
    const def = handler.getToolDefinition();
    handlers.set(def.name as McpToolName, handler);
  };

  add(new ReadFileTool(context));
  add(new WriteFileTool(context));
  add(new PatchFileTool(context));
  add(new DeleteFileTool(context));
  add(new MoveFileTool(context));
  add(new CreateDirectoryTool(context));
  add(new ListDirectoryTool(context));
  add(new GitCreateBranchTool(context));
  add(new GitCommitTool(context));
  add(new GitStatusTool(context));
  add(new RunCommandTool(context));
  add(new SearchFilesTool(context));
  add(new CreateRequestTool(context));
  add(new ListPlansTool(context));
  add(new ApprovePlanTool(context));
  add(new QueryJournalTool(context));

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
  permissions: PortalPermissionsService,
): Map<McpToolName, ToolHandler> {
  const all = buildHandlers(context, permissions);
  const dynamicNames = new Set(
    TOOL_MANIFEST
      .filter((e) =>
        (e.kind === ToolKind.MCP_HANDLER || e.kind === ToolKind.MCP_DOMAIN) &&
        e.dynamic_mode_allowed &&
        !e.requires_human_approval
      )
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
