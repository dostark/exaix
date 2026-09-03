/**
 * @module GitStatusTool
 * @path packages-team/mcp-server/handlers/git_status_tool.ts
 * @description MCP tool handler for checking git status in a portal.
 * @architectural-layer MCP
 * @related-files [packages/mcp/server/tool_handler.ts, packages/git/src/git_service.ts]
 */
import { ToolHandler } from "@exaix/mcp/server";
import type { MCPToolResponse } from "@exaix/schemas/mcp.ts";
import type { JSONValue } from "@exaix/core";
import { GitStatusFormat, PortalOperation, ToolErrorCode } from "@exaix/core";
import { GitStatusToolArgsSchema } from "@exaix/schemas/mcp.ts";

const GIT_SUBCOMMAND_STATUS = "status";

/** Queries git repository status in a portal, validating portal and git-repo existence and logging the operation to the Activity Journal. */
export class GitStatusTool extends ToolHandler {
  async execute(args: Record<string, JSONValue>): Promise<MCPToolResponse> {
    const validatedArgs = GitStatusToolArgsSchema.parse(args);
    const { portal, format, include_untracked, agent_role } = validatedArgs;

    try {
      // All tools make permission checking for portal operations
      this.validatePermission(portal, agent_role, PortalOperation.GIT);

      // Validate portal exists
      const portalPath = this.validatePortalExists(portal);

      // Check if git repository exists
      await this.validateGitRepository(portalPath, portal);

      // Get git status
      const statusArgs = [GIT_SUBCOMMAND_STATUS];
      if (format === GitStatusFormat.SHORT) {
        statusArgs.push("--short");
      } else if (format === GitStatusFormat.PORCELAIN) {
        statusArgs.push("--porcelain");
      }

      if (include_untracked === false) {
        statusArgs.push("--untracked-files=no");
      }

      // Route through IGitService for validated, timeout-bounded git execution
      const gitService = this.resolveGitService(portalPath);
      const { output: rawOutput } = await gitService.runGitCommand(statusArgs);

      const statusText = rawOutput.trim() ? rawOutput : "Working tree clean - no changes detected";

      return this.formatSuccess(
        "git_status",
        portal,
        agent_role,
        [{ type: "text", text: statusText }],
        {
          agent_role,
          format: format ?? GitStatusFormat.PORCELAIN,
          include_untracked: include_untracked !== false,
          has_changes: rawOutput.trim().length > 0,
        },
      );
    } catch (error) {
      return this.formatToolError(
        "git_status",
        portal,
        agent_role,
        ToolErrorCode.EXECUTION_FAILED,
        error instanceof Error ? error.message : String(error),
        {
          agent_role,
          format: format ?? GitStatusFormat.PORCELAIN,
          include_untracked: include_untracked !== false,
        },
      );
    }
  }

  getToolDefinition(): { name: string; description: string; inputSchema: Record<string, JSONValue> } {
    return {
      name: "git_status",
      description:
        "Show the working tree status (modified, staged, untracked files) of the portal git repository. Use to inspect pending changes before committing. Returns the git status output as a formatted string.",
      inputSchema: {
        type: "object",
        properties: {
          portal: {
            type: "string",
            description: "Portal name",
          },
          format: {
            type: "string",
            enum: Object.values(GitStatusFormat),
            description: "Optional: output format. short/porcelain are machine-friendly; long is human-readable.",
          },
          include_untracked: {
            type: "boolean",
            description: "Optional: include untracked files in status output (default: true)",
          },
          agent_role: {
            type: "string",
            description: "Identity identifier for permission checks",
          },
        },
        required: ["portal", "agent_role"],
      },
    };
  }
}
