/**
 * @module GitCommitTool
 * @path packages-team/mcp-server/handlers/git_commit_tool.ts
 * @description MCP tool handler for committing changes in a portal git repository.
 * @architectural-layer MCP
 * @related-files [packages/mcp/server/tool_handler.ts, packages/git/src/git_service.ts]
 */
import { ToolHandler } from "@exaix/mcp/server";
import type { MCPToolResponse } from "@exaix/schemas/mcp.ts";
import { JsonSchemaType, PortalOperation, ToolErrorCode } from "@exaix/core";
import type { JSONValue } from "@exaix/core";
import { GitCommitToolArgsSchema } from "@exaix/schemas/mcp.ts";
import { GIT_CMD_COMMIT } from "@exaix/git/constants.ts";

/** Commits changes in a portal git repo; permission/existence checks route through `ToolHandler`,
 * and all operations are logged to the IActivity Journal. */
export class GitCommitTool extends ToolHandler {
  async execute(args: Record<string, JSONValue>): Promise<MCPToolResponse> {
    const validatedArgs = GitCommitToolArgsSchema.parse(args) as {
      portal: string;
      message: string;
      files?: string[];
      amend?: boolean;
      signoff?: boolean;
      agent_role: string;
    };
    const { portal, message, files, amend, signoff, agent_role } = validatedArgs;

    try {
      // All tools make permission checking for portal operations
      this.validatePermission(portal, agent_role, PortalOperation.GIT);

      // Validate portal exists
      const portalPath = this.validatePortalExists(portal);

      // Check if git repository exists
      await this.validateGitRepository(portalPath, portal);

      // Stage files — route through IGitService with validateArgs
      let stageArgs: string[];
      if (files && files.length > 0) {
        stageArgs = ["add", ...files];
      } else {
        stageArgs = ["add", "."];
      }

      const gitService = this.resolveGitService(portalPath);
      const stageValidation = gitService.validateArgs(stageArgs);
      if (!stageValidation.valid) {
        throw new Error(`Invalid stage arguments: ${stageValidation.reason}`);
      }
      await gitService.runGitCommand(stageArgs);

      // Commit changes
      const commitArgs = [GIT_CMD_COMMIT];
      if (amend) {
        commitArgs.push("--amend");
      }
      if (signoff) {
        commitArgs.push("--signoff");
      }
      commitArgs.push("-m", message);

      const commitValidation = gitService.validateArgs(commitArgs);
      if (!commitValidation.valid) {
        throw new Error(`Invalid commit arguments: ${commitValidation.reason}`);
      }
      await gitService.runGitCommand(commitArgs);

      const { output: hashRaw } = await gitService.runGitCommand(["rev-parse", "HEAD"]);
      const commitHash = hashRaw.trim();

      return this.formatSuccess(
        "git_commit",
        portal,
        agent_role,
        [{ type: "text", text: commitHash }],
        {
          message,
          files: files?.length || "all",
          amend: !!amend,
          signoff: !!signoff,
          agent_role,
          commit_sha: commitHash,
        },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const code = message.includes("not permitted") || message.includes("Permission denied")
        ? ToolErrorCode.PERMISSION_DENIED
        : ToolErrorCode.EXECUTION_FAILED;

      return this.formatToolError("git_commit", portal, agent_role, code, message, {
        message,
        files: files?.length || "all",
        amend: !!amend,
        signoff: !!signoff,
        agent_role,
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
          agent_role: {
            type: "string",
            description: "Identity identifier for permission checks",
          },
        },
        required: ["portal", "message", "agent_role"],
      },
    };
  }
}
