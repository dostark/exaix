/**
 * @module GitCreateBranchTool
 * @path src/mcp/handlers/git_create_branch_tool.ts
 * @description MCP tool handler for creating feature branches in a portal git repository.
 * @architectural-layer MCP
 * @related-files [src/mcp/tool_handler.ts, src/services/core/git_service.ts]
 */
import { ToolHandler } from "../tool_handler.ts";
import type { MCPToolResponse } from "@exaix/schemas/mcp.ts";
import { PortalOperation, ToolErrorCode } from "@exaix/core";
import type { JSONValue } from "@exaix/core";
import { GitCreateBranchToolArgsSchema } from "@exaix/schemas/mcp.ts";

/**
 * GitCreateBranchTool - Creates feature branches in portal git repositories
 *
 * Security:
 * - Validates portal exists
 * - Validates branch name format (feat/, fix/, docs/, chore/, refactor/, test/)
 * - Checks if git repository exists
 * - Logs all operations to IActivity Journal
 */
export class GitCreateBranchTool extends ToolHandler {
  async execute(args: Record<string, JSONValue>): Promise<MCPToolResponse> {
    const validatedArgs = GitCreateBranchToolArgsSchema.parse(args) as {
      portal: string;
      branch: string;
      identity_id: string;
    };
    const { portal, branch, identity_id } = validatedArgs;

    try {
      // All tools make permission checking for portal operations
      this.validatePermission(portal, identity_id, PortalOperation.GIT);

      // Validate portal exists
      const portalPath = this.validatePortalExists(portal);

      // Check if git repository exists
      await this.validateGitRepository(portalPath, portal);

      // Create branch using git command
      const cmd = new Deno.Command("git", {
        args: ["checkout", "-b", branch],
        cwd: portalPath,
        stdout: "piped",
        stderr: "piped",
      });

      const { code, stderr } = await cmd.output();

      if (code !== 0) {
        const error = new TextDecoder().decode(stderr);
        throw new Error(`Failed to create branch: ${error}`);
      }

      return this.formatSuccess(
        "git_create_branch",
        portal,
        identity_id,
        [{ type: "text", text: `Branch '${branch}' created and checked out successfully in portal '${portal}'` }],
        { branch, identity_id },
      );
    } catch (error) {
      return this.formatToolError(
        "git_create_branch",
        portal,
        identity_id,
        ToolErrorCode.EXECUTION_FAILED,
        error instanceof Error ? error.message : String(error),
        { branch, identity_id },
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
          identity_id: {
            type: "string",
            description: "Identity identifier for permission checks",
          },
        },
        required: ["portal", "branch", "identity_id"],
      },
    };
  }
}
