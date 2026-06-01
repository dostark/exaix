/**
 * @module GitWorktreeTool
 * @path packages/mcp/server/handlers/git_worktree_tool.ts
 * @description MCP tool handler for managing git worktrees in a portal.
 * @architectural-layer MCP
 * @related-files [packages/mcp/server/tool_handler.ts, packages/git/src/git_service.ts]
 */
import { ToolHandler } from "../tool_handler.ts";
import type { MCPToolResponse } from "@exaix/schemas/mcp.ts";
import { GitWorktreeAction, PortalOperation, ToolErrorCode } from "@exaix/core";
import type { JSONValue } from "@exaix/core";
import { GitWorktreeToolArgsSchema } from "@exaix/schemas/mcp.ts";

/**
 * GitWorktreeTool - Manages git worktrees in portals
 */
export class GitWorktreeTool extends ToolHandler {
  async execute(args: Record<string, JSONValue>): Promise<MCPToolResponse> {
    const validatedArgs = GitWorktreeToolArgsSchema.parse(args);

    const {
      portal,
      action,
      path,
      ref,
      branch,
      detach,
      force,
      lock,
      reason,
      porcelain,
      dry_run,
      verbose,
      expire,
      identity_id,
    } = validatedArgs;

    try {
      this.validatePermission(portal, identity_id, PortalOperation.GIT);
      const portalPath = this.validatePortalExists(portal);
      await this.validateGitRepository(portalPath, portal);

      const worktreeArgs = ["worktree", action];
      let resolvedPath: string | undefined;

      if (action === GitWorktreeAction.LIST) {
        if (porcelain) {
          worktreeArgs.push("--porcelain");
        }
      }

      if (action === GitWorktreeAction.ADD) {
        if (!path) {
          throw new Error("Path is required for worktree add");
        }

        resolvedPath = this.resolvePortalPath(portalPath, path);

        if (force) {
          worktreeArgs.push("--force");
        }
        if (detach) {
          worktreeArgs.push("--detach");
        }
        if (lock) {
          worktreeArgs.push("--lock");
        }
        if (reason) {
          worktreeArgs.push("--reason", reason);
        }
        if (branch) {
          worktreeArgs.push("-b", branch);
        }

        worktreeArgs.push(resolvedPath);
        if (ref) {
          worktreeArgs.push(ref);
        }
      }

      if (action === GitWorktreeAction.REMOVE) {
        if (!path) {
          throw new Error("Path is required for worktree remove");
        }
        resolvedPath = this.resolvePortalPath(portalPath, path);
        if (force) {
          worktreeArgs.push("--force");
        }
        worktreeArgs.push(resolvedPath);
      }

      if (action === GitWorktreeAction.PRUNE) {
        if (dry_run) {
          worktreeArgs.push("--dry-run");
        }
        if (verbose) {
          worktreeArgs.push("--verbose");
        }
        if (expire) {
          worktreeArgs.push(`--expire=${expire}`);
        }
      }

      if (action === GitWorktreeAction.LOCK) {
        if (!path) {
          throw new Error("Path is required for worktree lock");
        }
        resolvedPath = this.resolvePortalPath(portalPath, path);
        if (reason) {
          worktreeArgs.push("--reason", reason);
        }
        worktreeArgs.push(resolvedPath);
      }

      if (action === GitWorktreeAction.UNLOCK) {
        if (!path) {
          throw new Error("Path is required for worktree unlock");
        }
        resolvedPath = this.resolvePortalPath(portalPath, path);
        worktreeArgs.push(resolvedPath);
      }

      const cmd = new Deno.Command("git", {
        args: worktreeArgs,
        cwd: portalPath,
        stdout: "piped",
        stderr: "piped",
      });

      const { code, stdout, stderr } = await cmd.output();

      if (code !== 0) {
        const error = new TextDecoder().decode(stderr);
        throw new Error(`Failed to execute git worktree ${action}: ${error}`);
      }

      const output = new TextDecoder().decode(stdout).trim();
      const text = output || `git worktree ${action} completed successfully`;

      return this.formatSuccess(
        "git_worktree",
        portal,
        identity_id,
        [{ type: "text", text }],
        {
          action,
          path: path ?? null,
          branch: branch ?? null,
          ref: ref ?? null,
          force: !!force,
          identity_id,
        },
      );
    } catch (error) {
      return this.formatToolError(
        "git_worktree",
        portal,
        identity_id,
        ToolErrorCode.EXECUTION_FAILED,
        error instanceof Error ? error.message : String(error),
        {
          action,
          path: path ?? null,
          identity_id,
        },
      );
    }
  }

  getToolDefinition(): { name: string; description: string; inputSchema: Record<string, JSONValue> } {
    return {
      name: "git_worktree",
      description:
        "Manage git worktrees in the portal repository. Use this tool when you need parallel checkouts for branch work, cleanup stale worktrees, or inspect active worktree state. Supports add/list/remove/prune/lock/unlock actions and important flags such as force, detach, porcelain output, dry-run prune, and lock reasons. Returns command output as text.",
      inputSchema: {
        type: "object",
        properties: {
          portal: { type: "string", description: "Portal name" },
          action: {
            type: "string",
            enum: Object.values(GitWorktreeAction),
            description: "Worktree subcommand to execute",
          },
          path: {
            type: "string",
            description: "Repository-relative worktree path (required for add/remove/lock/unlock)",
          },
          ref: { type: "string", description: "Optional base commit/ref for add" },
          branch: { type: "string", description: "Optional branch name to create during add (-b)" },
          detach: { type: "boolean", description: "Optional: add detached worktree" },
          force: { type: "boolean", description: "Optional: force add/remove" },
          lock: { type: "boolean", description: "Optional: lock newly created worktree during add" },
          reason: { type: "string", description: "Optional lock reason for add/lock" },
          porcelain: { type: "boolean", description: "Optional: list output in porcelain format" },
          dry_run: { type: "boolean", description: "Optional: prune dry run" },
          verbose: { type: "boolean", description: "Optional: prune verbose output" },
          expire: { type: "string", description: "Optional prune expiration threshold (e.g. '2.days.ago')" },
          identity_id: { type: "string", description: "Identity identifier for permission checks" },
        },
        required: ["portal", "action", "identity_id"],
      },
    };
  }
}
