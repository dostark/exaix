/**
 * @module GitStatusTool
 * @path src/mcp/handlers/git_status_tool.ts
 * @description MCP tool handler for checking git status in a portal.
 * @architectural-layer MCP
 * * @related-files [src/mcp/tool_handler.ts, src/services/core/git_service.ts]
 */
import { ToolHandler } from "../tool_handler.ts";
import { type MCPToolResponse } from "../../shared/schemas/mcp.ts";
import type { JSONValue } from "../../shared/types/json.ts";
import { PortalOperation } from "../../shared/enums.ts";
import { GitStatusToolArgsSchema } from "../../shared/schemas/mcp.ts";

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
    const validatedArgs = GitStatusToolArgsSchema.parse(args) as {
      portal: string;
      identity_id: string;
    };
    const { portal, identity_id } = validatedArgs;

    try {
      // All tools make permission checking for portal operations
      this.validatePermission(portal, identity_id, PortalOperation.GIT);

      // Validate portal exists
      const portalPath = this.validatePortalExists(portal);

      // Check if git repository exists
      await this.validateGitRepository(portalPath, portal);

      // Get git status
      const cmd = new Deno.Command("git", {
        args: ["status", "--porcelain"],
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
        statusText,
        { identity_id, has_changes: output.trim().length > 0 },
      );
    } catch (error) {
      this.formatError("git_status", portal, identity_id, error, { identity_id });
    }
  }

  getToolDefinition() {
    return {
      name: "git_status",
      description: "Query git repository status in a portal",
      inputSchema: {
        type: "object",
        properties: {
          portal: {
            type: "string",
            description: "Portal name",
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
