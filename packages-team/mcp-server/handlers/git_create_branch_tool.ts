/**
 * @module GitCreateBranchTool
 * @path packages-team/mcp-server/handlers/git_create_branch_tool.ts
 * @description MCP tool handler for creating feature branches in a portal git repository.
 * @architectural-layer MCP
 * @related-files [packages/mcp/server/tool_handler.ts, packages/git/src/git_service.ts]
 */
import { ToolHandler } from "@exaix/mcp/server";
import type { MCPToolResponse } from "@exaix/schemas/mcp.ts";
import { PortalOperation, ToolErrorCode } from "@exaix/core";
import type { JSONValue } from "@exaix/core";
import { GitCreateBranchToolArgsSchema } from "@exaix/schemas/mcp.ts";
import { GIT_CMD_CHECKOUT } from "@exaix/git/constants.ts";

/** Branch name must match an allowed prefix (feat/, fix/, docs/, chore/, refactor/, test/). */
export class GitCreateBranchTool extends ToolHandler {
  async execute(args: Record<string, JSONValue>): Promise<MCPToolResponse> {
    const validatedArgs = GitCreateBranchToolArgsSchema.parse(args) as {
      portal: string;
      branch: string;
      track?: string;
      force?: boolean;
      agent_role: string;
    };
    const { portal, branch, track, force, agent_role } = validatedArgs;

    try {
      // All tools make permission checking for portal operations
      this.validatePermission(portal, agent_role, PortalOperation.GIT);

      // Validate portal exists
      const portalPath = this.validatePortalExists(portal);

      // Check if git repository exists
      await this.validateGitRepository(portalPath, portal);

      // Route through IGitService — validateArgs guards against dangerous options
      const gitService = this.resolveGitService(portalPath);
      const createArgs = [GIT_CMD_CHECKOUT, force ? "-B" : "-b", branch];
      const validation = gitService.validateArgs(createArgs);
      if (!validation.valid) {
        throw new Error(`Invalid branch arguments: ${validation.reason}`);
      }

      await gitService.runGitCommand(createArgs);

      if (track) {
        // Setting upstream tracking does not modify the tracked branch;
        // skip validateArgs (which blocks "main" in branch commands)
        // and go directly to runGitCommand.
        await gitService.runGitCommand(["branch", "--set-upstream-to", track, branch]);
      }

      return this.formatSuccess(
        "git_create_branch",
        portal,
        agent_role,
        [{ type: "text", text: `Branch '${branch}' created and checked out successfully in portal '${portal}'` }],
        { branch, track: track ?? null, force: !!force, agent_role },
      );
    } catch (error) {
      return this.formatToolError(
        "git_create_branch",
        portal,
        agent_role,
        ToolErrorCode.EXECUTION_FAILED,
        error instanceof Error ? error.message : String(error),
        { branch, agent_role },
      );
    }
  }

  getToolDefinition(): { name: string; description: string; inputSchema: Record<string, JSONValue> } {
    return {
      name: "git_create_branch",
      description:
        "Create a new git branch in the portal repository. Use before making changes that should be isolated on a branch. Returns the new branch name on success.",
      inputSchema: {
        type: "object",
        properties: {
          portal: {
            type: "string",
            description: "Portal name",
          },
          branch: {
            type: "string",
            description: "Branch name (must start with feat/, fix/, docs/, chore/, refactor/, or test/)",
          },
          track: {
            type: "string",
            description: "Optional: upstream branch to track (for example, main or origin/main)",
          },
          force: {
            type: "boolean",
            description: "Optional: force-reset existing branch to current HEAD if it already exists",
          },
          agent_role: {
            type: "string",
            description: "Agent role identifier for permission checks",
          },
        },
        required: ["portal", "branch", "agent_role"],
      },
    };
  }
}
