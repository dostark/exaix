/**
 * @module DeleteFileTool
 * @path packages/mcp/server/handlers/delete_file_tool.ts
 * @description MCP tool handler for deleting a single file from a portal.
 * Destructive and irreversible at the filesystem level — git history preserves deleted files.
 * @architectural-layer MCP
 * @related-files [packages/mcp/server/tool_handler.ts]
 */
import { ToolHandler } from "../tool_handler.ts";
import { DeleteFileToolArgsSchema, type MCPToolResponse } from "@exaix/schemas/mcp.ts";
import { PortalOperation, ToolErrorCode } from "@exaix/core";
import { McpToolName } from "@exaix/mcp";
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
      return this.formatToolError(
        McpToolName.DELETE_FILE,
        portal,
        identity_id,
        ToolErrorCode.NOT_FOUND,
        `File not found: ${path}`,
        { path },
      );
    }

    if (!stat.isFile) {
      return this.formatToolError(
        McpToolName.DELETE_FILE,
        portal,
        identity_id,
        ToolErrorCode.INVALID_ARGS,
        `"${path}" is a directory, not a file. Use delete_directory to remove directories (when available).`,
        { path },
      );
    }

    await Deno.remove(absolutePath);

    this.logToolExecution(McpToolName.DELETE_FILE, portal, identity_id, {
      path,
      bytes_deleted: stat.size,
      success: true,
    });

    return {
      content: [
        {
          type: "text",
          text: `${McpToolName.DELETE_FILE} success on ${path}. Deleted ${stat.size} bytes.`,
        },
      ],
    };
  }

  getToolDefinition(): { name: string; description: string; inputSchema: Record<string, JSONValue> } {
    return {
      name: McpToolName.DELETE_FILE,
      description:
        "Permanently delete a file inside a portal. Use only when you are certain the file is no longer needed; the operation is irreversible unless the portal is under git version control. Returns a success confirmation message.",
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
