/**
 * @module GitCommitTool
 * @path src/mcp/handlers/git_commit_tool.ts
 * @description MCP tool handler for committing changes in a portal git repository.
 * @architectural-layer MCP
 * @related-files [src/mcp/tool_handler.ts, src/services/core/git_service.ts]
 */
import { ToolHandler } from "../tool_handler.ts";
import type { MCPToolResponse } from "@exaix/schemas/mcp.ts";
import { PortalOperation } from "@exaix/core";
import type { JSONValue } from "@exaix/core";
import { GitCommitToolArgsSchema } from "@exaix/schemas/mcp.ts";

/**
 * GitCommitTool - Commits changes in portal git repositories
 *
 * Security:
 * - Validates portal exists
 * - Validates commit message not empty
 * - Optionally commits specific files
 * - Checks if git repository exists
 * - Logs all operations to IActivity Journal
 */
export class GitCommitTool extends ToolHandler {
  async execute(args: Record<string, JSONValue>): Promise<MCPToolResponse> {
    const validatedArgs = GitCommitToolArgsSchema.parse(args) as {
      portal: string;
      message: string;
      files?: string[];
      identity_id: string;
    };
    const { portal, message, files, identity_id } = validatedArgs;

    try {
      // All tools make permission checking for portal operations
      this.validatePermission(portal, identity_id, PortalOperation.GIT);

      // Validate portal exists
      const portalPath = this.validatePortalExists(portal);

      // Check if git repository exists
      await this.validateGitRepository(portalPath, portal);

      // Stage files
      let stageArgs: string[];
      if (files && files.length > 0) {
        stageArgs = ["add", ...files];
      } else {
        stageArgs = ["add", "."];
      }

      const stageCmd = new Deno.Command("git", {
        args: stageArgs,
        cwd: portalPath,
        stdout: "piped",
        stderr: "piped",
      });

      await stageCmd.output();

      // Commit changes
      const commitCmd = new Deno.Command("git", {
        args: ["commit", "-m", message],
        cwd: portalPath,
        stdout: "piped",
        stderr: "piped",
      });

      const { code, stderr } = await commitCmd.output();

      if (code !== 0) {
        const error = new TextDecoder().decode(stderr);
        throw new Error(`Failed to commit: ${error}`);
      }

      return this.formatSuccess(
        "git_commit",
        portal,
        identity_id,
        [{ type: "text", text: `Changes committed successfully in portal '${portal}': ${message}` }],
        { message, files: files?.length || "all", identity_id },
      );
    } catch (error) {
      this.formatError("git_commit", portal, identity_id, error, {
        message,
        files: files?.length || "all",
        identity_id,
      });
    }
  }

  getToolDefinition(): { name: string; description: string; inputSchema: Record<string, JSONValue> } {
    return {
      name: "git_commit",
      description:
        "Stage all changes and create a git commit in the portal repository. Use after writing or modifying files to record the change. Returns the commit hash of the newly created commit.",
      inputSchema: {
        type: "object",
        properties: {
          portal: {
            type: "string",
            description: "Portal name",
          },
          message: {
            type: "string",
            description: "Commit message",
          },
          files: {
            type: "array",
            items: { type: "string" },
            description: "Optional: specific files to commit (defaults to all changes)",
          },
          identity_id: {
            type: "string",
            description: "Identity identifier for permission checks",
          },
        },
        required: ["portal", "message", "identity_id"],
      },
    };
  }
}
