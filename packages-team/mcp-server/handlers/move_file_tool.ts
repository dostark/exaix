/**
 * @module MoveFileTool
 * @path packages-team/mcp-server/handlers/move_file_tool.ts
 * @description MCP tool handler for moving or renaming a file within a portal.
 * Used for rename/restructure tasks. Both source and destination must be within portal bounds.
 * @architectural-layer MCP
 * @related-files [packages/mcp/server/tool_handler.ts]
 */
import { dirname } from "@std/path";
import { ToolHandler } from "@exaix/mcp/server";
import { type MCPToolResponse, MoveFileToolArgsSchema } from "@exaix/schemas/mcp.ts";
import { PortalOperation, ToolErrorCode } from "@exaix/core";
import { McpToolName } from "@exaix/mcp";
import type { JSONValue } from "@exaix/core";

/** A plain filesystem rename — in git repositories, agents should follow with
 *  git_commit so git tracks it as a rename (preserving history). */
export class MoveFileTool extends ToolHandler {
  async execute(args: Record<string, JSONValue>): Promise<MCPToolResponse> {
    const validatedArgs = MoveFileToolArgsSchema.parse(args) as {
      portal: string;
      from: string;
      to: string;
      agent_role: string;
    };
    const { portal, from, to, agent_role } = validatedArgs;

    try {
      this.validatePermission(portal, agent_role, PortalOperation.WRITE);

      const portalPath = this.validatePortalExists(portal);

      // Validate both paths independently
      const absoluteFrom = await this.resolvePortalPath(portalPath, from);
      const absoluteTo = await this.resolvePortalPath(portalPath, to);

      // Verify source exists and is a regular file
      let stat: Deno.FileInfo;
      try {
        stat = await Deno.stat(absoluteFrom);
      } catch {
        throw new Error(`Source file not found: ${from}`);
      }

      if (!stat.isFile) {
        throw new Error(
          `"${from}" is a directory, not a file. MoveFileTool only moves regular files.`,
        );
      }

      // Check destination doesn't already exist (prevent silent overwrites)
      try {
        await Deno.stat(absoluteTo);
        throw new Error(
          `Destination already exists: "${to}". ` +
            `Delete it first or choose a different destination path.`,
        );
      } catch (err) {
        // Only re-throw if it's our "already exists" error, not the "not found" error
        if (err instanceof Error && err.message.startsWith("Destination already exists")) {
          throw err;
        }
        // Not found — safe to proceed
      }

      // Create destination parent directories if needed
      await Deno.mkdir(dirname(absoluteTo), { recursive: true });

      // Perform the move
      await Deno.rename(absoluteFrom, absoluteTo);

      this.logToolExecution(McpToolName.MOVE_FILE, portal, agent_role, {
        from,
        to,
        bytes: stat.size,
        success: true,
      });

      return {
        content: [
          {
            type: "text",
            text: `move_file success: moved ${from} to ${to}.`,
          },
        ],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      let code = ToolErrorCode.EXECUTION_FAILED;
      if (message.startsWith("Source file not found")) code = ToolErrorCode.NOT_FOUND;
      if (message.startsWith("Destination already exists") || message.includes("is a directory")) {
        code = ToolErrorCode.INVALID_ARGS;
      }
      return this.formatToolError(McpToolName.MOVE_FILE, portal, agent_role, code, message, { from, to });
    }
  }

  getToolDefinition(): { name: string; description: string; inputSchema: Record<string, JSONValue> } {
    return {
      name: McpToolName.MOVE_FILE,
      description:
        "Move or rename a file within a portal. The source path is removed after the move. Use for file reorganization or renaming; not for copying. Returns a success confirmation message.",
      inputSchema: {
        type: "object",
        properties: {
          portal: { type: "string", description: "Portal alias" },
          from: { type: "string", description: "Source file path relative to portal root" },
          to: { type: "string", description: "Destination file path relative to portal root" },
          agent_role: { type: "string", description: "Agent role identifier for permission checks" },
        },
        required: ["portal", "from", "to", "agent_role"],
      },
    };
  }
}
