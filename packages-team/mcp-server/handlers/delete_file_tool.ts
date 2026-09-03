/**
 * @module DeleteFileTool
 * @path packages-team/mcp-server/handlers/delete_file_tool.ts
 * @description MCP tool handler for deleting a single file from a portal.
 * Destructive and irreversible at the filesystem level — git history preserves deleted files.
 * @architectural-layer MCP
 * @related-files [packages/mcp/server/tool_handler.ts]
 */
import { ToolHandler } from "@exaix/mcp/server";
import { DeleteFileToolArgsSchema, type MCPToolResponse } from "@exaix/schemas/mcp.ts";
import { PortalOperation, ToolErrorCode } from "@exaix/core";
import { McpToolName } from "@exaix/mcp";
import type { JSONValue } from "@exaix/core";

/** Only removes regular files — refuses directories (use delete_directory when
 *  implemented). Agents should follow with git_commit to register the deletion. */
export class DeleteFileTool extends ToolHandler {
  async execute(args: Record<string, JSONValue>): Promise<MCPToolResponse> {
    const validatedArgs = DeleteFileToolArgsSchema.parse(args) as {
      portal: string;
      path: string;
      agent_role: string;
    };
    const { portal, path, agent_role } = validatedArgs;

    this.validatePermission(portal, agent_role, PortalOperation.WRITE);

    const portalPath = this.validatePortalExists(portal);
    const absolutePath = await this.resolvePortalPath(portalPath, path);

    // Verify target exists and is a regular file (not a directory)
    let stat: Deno.FileInfo;
    try {
      stat = await Deno.stat(absolutePath);
    } catch {
      return this.formatToolError(
        McpToolName.DELETE_FILE,
        portal,
        agent_role,
        ToolErrorCode.NOT_FOUND,
        `File not found: ${path}`,
        { path },
      );
    }

    if (!stat.isFile) {
      return this.formatToolError(
        McpToolName.DELETE_FILE,
        portal,
        agent_role,
        ToolErrorCode.INVALID_ARGS,
        `"${path}" is a directory, not a file. Use delete_directory to remove directories (when available).`,
        { path },
      );
    }

    await Deno.remove(absolutePath);

    this.logToolExecution(McpToolName.DELETE_FILE, portal, agent_role, {
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
          agent_role: { type: "string", description: "Identity identifier for permission checks" },
        },
        required: ["portal", "path", "agent_role"],
      },
    };
  }
}
