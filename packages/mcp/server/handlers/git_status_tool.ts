/**
 * @module GitStatusTool
 * @path packages/mcp/server/handlers/git_status_tool.ts
 * @description MCP tool handler for checking git status in a portal.
 * @architectural-layer MCP
 * @related-files [packages/mcp/server/tool_handler.ts, packages/git/src/git_service.ts]
 */
import { ToolHandler } from "../tool_handler.ts";
import type { MCPToolResponse } from "@exaix/schemas/mcp.ts";
import type { JSONValue } from "@exaix/core";
import { GitStatusFormat, PortalOperation, ToolErrorCode } from "@exaix/core";
import { GitStatusToolArgsSchema } from "@exaix/schemas/mcp.ts";

/**
 * GitStatusTool - Queries git repository status in portals
 *
 * Security:
 * - Validates portal exists
 * - Checks if git repository exists
 * - Returns formatted status output
 * - Logs all operations to IActivity Journal
 */
export class GitStatusTool extends ToolHandler {
  async execute(args: Record<string, JSONValue>): Promise<MCPToolResponse> {
    const validatedArgs = GitStatusToolArgsSchema.parse(args);
    const { portal, format, include_untracked, identity_id } = validatedArgs;

    try {
      // All tools make permission checking for portal operations
      this.validatePermission(portal, identity_id, PortalOperation.GIT);

      // Validate portal exists
      const portalPath = this.validatePortalExists(portal);

      // Check if git repository exists
      await this.validateGitRepository(portalPath, portal);

      // Get git status
      const statusArgs = ["status"];
      if (format === GitStatusFormat.SHORT) {
        statusArgs.push("--short");
      } else if (format === GitStatusFormat.PORCELAIN) {
        statusArgs.push("--porcelain");
      }

      if (include_untracked === false) {
        statusArgs.push("--untracked-files=no");
      }

      const cmd = new Deno.Command("git", {
        args: statusArgs,
        cwd: portalPath,
        stdout: "piped",
        stderr: "piped",
      });

      const { code, stdout, stderr } = await cmd.output();

      if (code !== 0) {
        const error = new TextDecoder().decode(stderr);
        throw new Error(`Failed to get status: ${error}`);
      }

      const output = new TextDecoder().decode(stdout);
      const statusText = output.trim() ? output : "Working tree clean - no changes detected";

      return this.formatSuccess(
        "git_status",
        portal,
        identity_id,
        [{ type: "text", text: statusText }],
        {
          identity_id,
          format: format ?? GitStatusFormat.PORCELAIN,
          include_untracked: include_untracked !== false,
          has_changes: output.trim().length > 0,
        },
      );
    } catch (error) {
      return this.formatToolError(
        "git_status",
        portal,
        identity_id,
        ToolErrorCode.EXECUTION_FAILED,
        error instanceof Error ? error.message : String(error),
        {
          identity_id,
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
          identity_id: {
            type: "string",
            description: "Identity identifier for permission checks",
          },
        },
        required: ["portal", "identity_id"],
      },
    };
  }
}
