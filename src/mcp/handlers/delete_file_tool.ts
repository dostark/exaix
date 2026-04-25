/**
 * @module DeleteFileTool
 * @path src/mcp/handlers/delete_file_tool.ts
 * @description MCP tool handler for deleting a single file from a portal.
 * Destructive and irreversible at the filesystem level — git history preserves deleted files.
 * @architectural-layer MCP
 * * @related-files [src/mcp/tool_handler.ts]
 */
import { ToolHandler } from "../tool_handler.ts";
import { DeleteFileToolArgsSchema, type MCPToolResponse } from "@exaix/schemas/mcp.ts";
import { PortalOperation } from "../../shared/enums.ts";
import type { JSONValue } from "@exaix/core";

/**
 * DeleteFileTool — removes a single file from a portal.
 *
 * Security:
 * - Validates portal exists
 * - Prevents path traversal
 * - Requires PortalOperation.WRITE permission
 * - Only removes regular files — refuses directories (use delete_directory when implemented)
 * - Logs deletion to Activity Journal
 *
 * Note: File is deleted at the filesystem level. If the portal is a git repository,
 * the deletion is recoverable via git history after a subsequent git_commit.
 * Agents should follow delete_file with git_commit to register the deletion.
 */
export class DeleteFileTool extends ToolHandler {
  async execute(args: Record<string, JSONValue>): Promise<MCPToolResponse> {
    const validatedArgs = DeleteFileToolArgsSchema.parse(args) as {
      portal: string;
      path: string;
      identity_id: string;
    };
    const { portal, path, identity_id } = validatedArgs;

    this.validatePermission(portal, identity_id, PortalOperation.WRITE);

    const portalPath = this.validatePortalExists(portal);
    const absolutePath = this.resolvePortalPath(portalPath, path);

    // Verify target exists and is a regular file (not a directory)
    let stat: Deno.FileInfo;
    try {
      stat = await Deno.stat(absolutePath);
    } catch {
      throw new Error(`File not found: ${path}`);
    }

    if (!stat.isFile) {
      throw new Error(
        `"${path}" is a directory, not a file. ` +
          `Use delete_directory to remove directories (when available).`,
      );
    }

    await Deno.remove(absolutePath);

    this.logToolExecution("delete_file", portal, identity_id, {
      path,
      bytes_deleted: stat.size,
      success: true,
    });

    return {
      content: [
        {
          type: "text",
          text: `delete_file success on ${path}. Deleted ${stat.size} bytes.`,
        },
      ],
    };
  }

  getToolDefinition(): { name: string; description: string; inputSchema: Record<string, JSONValue> } {
    return {
      name: "delete_file",
      description: "Delete a single file from a portal. " +
        "Irreversible at the filesystem level, but recoverable from git history " +
        "if the portal is a git repository. " +
        "Does not accept directory paths — only regular files.",
      inputSchema: {
        type: "object",
        properties: {
          portal: { type: "string", description: "Portal alias" },
          path: { type: "string", description: "File path relative to portal root" },
          identity_id: { type: "string", description: "Identity identifier for permission checks" },
        },
        required: ["portal", "path", "identity_id"],
      },
    };
  }
}
