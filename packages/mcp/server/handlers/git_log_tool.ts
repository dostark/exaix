/**
 * @module GitLogTool
 * @path packages/mcp/server/handlers/git_log_tool.ts
 * @description MCP tool handler for querying git commit history in a portal.
 * @architectural-layer MCP
 * @related-files [packages/mcp/server/tool_handler.ts, packages/git/src/git_service.ts]
 */
import { ToolHandler } from "../tool_handler.ts";
import type { MCPToolResponse } from "@exaix/schemas/mcp.ts";
import { GitLogFormat, PortalOperation, ToolErrorCode } from "@exaix/core";
import type { JSONValue } from "@exaix/core";
import { GitLogToolArgsSchema } from "@exaix/schemas/mcp.ts";
import { GIT_CMD_LOG } from "@exaix/git";

/**
 * GitLogTool - Queries git commit history in portals
 */
export class GitLogTool extends ToolHandler {
  async execute(args: Record<string, JSONValue>): Promise<MCPToolResponse> {
    const validatedArgs = GitLogToolArgsSchema.parse(args);

    const {
      portal,
      ref,
      max_count,
      skip,
      since,
      until,
      author,
      grep,
      path,
      no_merges,
      reverse,
      decorate,
      format,
      custom_format,
      identity_id,
    } = validatedArgs;

    try {
      this.validatePermission(portal, identity_id, PortalOperation.GIT);
      const portalPath = this.validatePortalExists(portal);
      await this.validateGitRepository(portalPath, portal);

      const logArgs = [GIT_CMD_LOG];

      if (typeof max_count === "number") {
        logArgs.push(`--max-count=${max_count}`);
      }
      if (typeof skip === "number" && skip > 0) {
        logArgs.push(`--skip=${skip}`);
      }
      if (since) {
        logArgs.push(`--since=${since}`);
      }
      if (until) {
        logArgs.push(`--until=${until}`);
      }
      if (author) {
        logArgs.push(`--author=${author}`);
      }
      if (grep) {
        logArgs.push(`--grep=${grep}`);
      }
      if (no_merges) {
        logArgs.push("--no-merges");
      }
      if (reverse) {
        logArgs.push("--reverse");
      }
      if (decorate) {
        logArgs.push("--decorate");
      }

      if (format === GitLogFormat.ONELINE) {
        logArgs.push("--oneline");
      } else if (format === GitLogFormat.SHORT) {
        logArgs.push("--pretty=short");
      } else if (format === GitLogFormat.FULL) {
        logArgs.push("--pretty=full");
      } else if (format === GitLogFormat.FULLER) {
        logArgs.push("--pretty=fuller");
      } else if (format === GitLogFormat.CUSTOM && custom_format) {
        logArgs.push(`--pretty=format:${custom_format}`);
      }

      if (ref) {
        logArgs.push(ref);
      }
      if (path) {
        this.validatePathSafety(path);
        logArgs.push("--", path);
      }

      const cmd = new Deno.Command("git", {
        args: logArgs,
        cwd: portalPath,
        stdout: "piped",
        stderr: "piped",
      });

      const { code, stdout, stderr } = await cmd.output();

      if (code !== 0) {
        const error = new TextDecoder().decode(stderr);
        throw new Error(`Failed to get log: ${error}`);
      }

      const output = new TextDecoder().decode(stdout).trim();
      const logText = output || "No commits found for the specified filter";

      return this.formatSuccess(
        "git_log",
        portal,
        identity_id,
        [{ type: "text", text: logText }],
        {
          ref: ref ?? "HEAD",
          max_count: max_count ?? 50,
          path: path ?? null,
          format: format ?? GitLogFormat.ONELINE,
          identity_id,
        },
      );
    } catch (error) {
      return this.formatToolError(
        "git_log",
        portal,
        identity_id,
        ToolErrorCode.EXECUTION_FAILED,
        error instanceof Error ? error.message : String(error),
        { identity_id },
      );
    }
  }

  getToolDefinition(): { name: string; description: string; inputSchema: Record<string, JSONValue> } {
    return {
      name: "git_log",
      description:
        "Query git commit history in the portal repository with common filters and formatting. Use this tool when you need commit chronology, author/message filtering, or path-specific history. Supports max_count/skip pagination, date filters, author/message search, path filtering, and oneline/full/custom output modes. Returns git log output as text.",
      inputSchema: {
        type: "object",
        properties: {
          portal: { type: "string", description: "Portal name" },
          ref: { type: "string", description: "Optional git ref/range (default: HEAD)" },
          max_count: { type: "number", description: "Optional maximum number of commits (default: 50)" },
          skip: { type: "number", description: "Optional number of commits to skip" },
          since: { type: "string", description: "Optional lower date bound, e.g. '2 weeks ago' or ISO date" },
          until: { type: "string", description: "Optional upper date bound, e.g. '2026-01-31'" },
          author: { type: "string", description: "Optional author filter (substring/regex per git semantics)" },
          grep: { type: "string", description: "Optional commit message grep filter" },
          path: { type: "string", description: "Optional repository-relative path to filter history" },
          no_merges: { type: "boolean", description: "Optional: exclude merge commits" },
          reverse: { type: "boolean", description: "Optional: show commits in reverse order" },
          decorate: { type: "boolean", description: "Optional: show ref decorations" },
          format: {
            type: "string",
            enum: Object.values(GitLogFormat),
            description: "Optional output format (default: oneline)",
          },
          custom_format: {
            type: "string",
            description: "Required when format='custom'; git pretty format string",
          },
          identity_id: { type: "string", description: "Identity identifier for permission checks" },
        },
        required: ["portal", "identity_id"],
      },
    };
  }
}
