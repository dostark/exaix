/**
 * @module GitCommitTool
 * @path packages/mcp/server/handlers/git_commit_tool.ts
 * @description MCP tool handler for committing changes in a portal git repository.
 * @architectural-layer MCP
 * @related-files [packages/mcp/server/tool_handler.ts, packages/git/src/git_service.ts]
 */
import { ToolHandler } from "../tool_handler.ts";
import type { MCPToolResponse } from "@exaix/schemas/mcp.ts";
import { JsonSchemaType, PortalOperation, ToolErrorCode } from "@exaix/core";
import type { JSONValue } from "@exaix/core";
import { GitCommitToolArgsSchema } from "@exaix/schemas/mcp.ts";
import { GIT_CMD_COMMIT } from "@exaix/git";

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
      amend?: boolean;
      signoff?: boolean;
      identity_id: string;
    };
    const { portal, message, files, amend, signoff, identity_id } = validatedArgs;

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
      const commitArgs = [GIT_CMD_COMMIT];
      if (amend) {
        commitArgs.push("--amend");
      }
      if (signoff) {
        commitArgs.push("--signoff");
      }
      commitArgs.push("-m", message);

      const commitCmd = new Deno.Command("git", {
        args: commitArgs,
        cwd: portalPath,
        stdout: "piped",
        stderr: "piped",
      });

      const { code, stderr } = await commitCmd.output();

      if (code !== 0) {
        const error = new TextDecoder().decode(stderr);
        throw new Error(`Failed to commit: ${error}`);
      }

      const hashCmd = new Deno.Command("git", {
        args: ["rev-parse", "HEAD"],
        cwd: portalPath,
        stdout: "piped",
        stderr: "piped",
      });

      const { code: hashCode, stdout: hashStdout, stderr: hashStderr } = await hashCmd.output();
      if (hashCode !== 0) {
        const error = new TextDecoder().decode(hashStderr);
        throw new Error(`Failed to resolve commit hash: ${error}`);
      }

      const commitHash = new TextDecoder().decode(hashStdout).trim();

      return this.formatSuccess(
        "git_commit",
        portal,
        identity_id,
        [{ type: "text", text: commitHash }],
        {
          message,
          files: files?.length || "all",
          amend: !!amend,
          signoff: !!signoff,
          identity_id,
          commit_sha: commitHash,
        },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const code = message.includes("not permitted") || message.includes("Permission denied")
        ? ToolErrorCode.PERMISSION_DENIED
        : ToolErrorCode.EXECUTION_FAILED;

      return this.formatToolError("git_commit", portal, identity_id, code, message, {
        message,
        files: files?.length || "all",
        amend: !!amend,
        signoff: !!signoff,
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
            type: JsonSchemaType.ARRAY,
            items: { type: "string" },
            description: "Optional: specific files to commit (defaults to all changes)",
          },
          amend: {
            type: "boolean",
            description: "Optional: amend the previous commit instead of creating a new one",
          },
          signoff: {
            type: "boolean",
            description: "Optional: add Signed-off-by trailer to the commit message",
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
