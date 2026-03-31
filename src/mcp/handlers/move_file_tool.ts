/**
 * @module MoveFileTool
 * @path src/mcp/handlers/move_file_tool.ts
 * @description MCP tool handler for moving or renaming a file within a portal.
 * Used for rename/restructure tasks. Both source and destination must be within portal bounds.
 * @architectural-layer MCP
 * * @related-files [src/mcp/tool_handler.ts]
 */
import { dirname } from "@std/path";
import { ToolHandler } from "../tool_handler.ts";
import { type MCPToolResponse, MoveFileToolArgsSchema } from "../../shared/schemas/mcp.ts";
import { PortalOperation } from "../../shared/enums.ts";
import type { JSONValue } from "../../shared/types/json.ts";

/**
 * MoveFileTool — moves or renames a file within a portal.
 *
 * Security:
 * - Validates portal exists
 * - Prevents path traversal on BOTH source and destination
 * - Both paths must stay within portal bounds
 * - Requires PortalOperation.WRITE permission
 * - Only moves regular files — refuses directories
 * - Creates destination parent directories if needed
 * - Logs move to Activity Journal
 *
 * Note: This is a filesystem rename. In git repositories, agents should follow
 * move_file with git_commit so git tracks it as a rename (preserving history).
 */
export class MoveFileTool extends ToolHandler {
  async execute(args: Record<string, JSONValue>): Promise<MCPToolResponse> {
    const validatedArgs = MoveFileToolArgsSchema.parse(args) as {
      portal: string;
      from: string;
      to: string;
      identity_id: string;
    };
    const { portal, from, to, identity_id } = validatedArgs;

    this.validatePermission(portal, identity_id, PortalOperation.WRITE);

    const portalPath = this.validatePortalExists(portal);

    // Validate both paths independently
    const absoluteFrom = this.resolvePortalPath(portalPath, from);
    const absoluteTo = this.resolvePortalPath(portalPath, to);

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

    this.logToolExecution("move_file", portal, identity_id, {
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
  }

  getToolDefinition() {
    return {
      name: "move_file",
      description: "Move or rename a file within a portal. " +
        "Both source and destination must be within the portal bounds. " +
        "Destination must not already exist. " +
        "In git portals, follow with git_commit to register the rename in history.",
      inputSchema: {
        type: "object",
        properties: {
          portal: { type: "string", description: "Portal alias" },
          from: { type: "string", description: "Source file path relative to portal root" },
          to: { type: "string", description: "Destination file path relative to portal root" },
          identity_id: { type: "string", description: "Identity identifier for permission checks" },
        },
        required: ["portal", "from", "to", "identity_id"],
      },
    };
  }
}
