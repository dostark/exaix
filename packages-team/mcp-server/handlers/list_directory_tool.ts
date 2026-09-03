/**
 * @module ListDirectoryTool
 * @path packages-team/mcp-server/handlers/list_directory_tool.ts
 * @description MCP tool handler for listing directory contents in a portal with security validation.
 * @architectural-layer MCP
 * @related-files [packages/mcp/server/tool_handler.ts]
 */
import { ToolHandler } from "@exaix/mcp/server";
import { ListDirectoryToolArgsSchema, type MCPToolResponse } from "@exaix/schemas/mcp.ts";
import { MCP_CONTENT_TYPE_STRUCTURED_DATA, PortalOperation, ToolErrorCode } from "@exaix/core";
import { McpToolName } from "@exaix/mcp";
import type { JSONValue } from "@exaix/core";

/** Validates the portal and blocks path traversal before listing; logs every operation to the Activity Journal. */
export class ListDirectoryTool extends ToolHandler {
  async execute(args: Record<string, JSONValue>): Promise<MCPToolResponse> {
    const validatedArgs = ListDirectoryToolArgsSchema.parse(args) as {
      portal: string;
      path?: string;
      agent_role: string;
    };
    const { portal, path, identity_id } = validatedArgs;

    try {
      // All tools make permission checking for portal operations
      this.validatePermission(portal, identity_id, PortalOperation.READ);

      // Validate portal exists
      const portalPath = this.validatePortalExists(portal);

      // Resolve and validate path (defaults to portal root)
      const listPath = path || "";
      const absolutePath = await this.resolvePortalPath(portalPath, listPath);

      // Read directory
      const entries: string[] = [];
      for await (const entry of Deno.readDir(absolutePath)) {
        const displayName = entry.isDirectory ? `${entry.name}/` : entry.name;
        entries.push(displayName);
      }

      // Sort entries (directories first, then files)
      entries.sort((a, b) => {
        const aIsDir = a.endsWith("/");
        const bIsDir = b.endsWith("/");
        if (aIsDir && !bIsDir) return -1;
        if (!aIsDir && bIsDir) return 1;
        return a.localeCompare(b);
      });

      // Format listing
      const listing = entries.length > 0 ? entries.join("\n") : "(Directory is empty)";

      // Log successful execution
      this.logToolExecution(McpToolName.LIST_DIRECTORY, portal, identity_id, {
        path: listPath || "/",
        agent_role: identity_id ?? null,
        success: true,
        entry_count: entries.length,
      });

      return {
        content: [
          {
            type: "text",
            text: listing,
          },
          {
            type: MCP_CONTENT_TYPE_STRUCTURED_DATA,
            data: entries,
          },
        ],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return this.formatToolError(McpToolName.LIST_DIRECTORY, portal, identity_id, ToolErrorCode.NOT_FOUND, message, {
        path: path || "/",
        agent_role: identity_id ?? null,
      });
    }
  }

  getToolDefinition(): { name: string; description: string; inputSchema: Record<string, JSONValue> } {
    return {
      name: McpToolName.LIST_DIRECTORY,
      description:
        "List the files and subdirectories at a path inside a portal. Use to check whether a file exists, explore directory structure, or enumerate files before processing. Returns an array of entry names.",
      inputSchema: {
        type: "object",
        properties: {
          portal: {
            type: "string",
            description: "Portal name",
          },
          path: {
            type: "string",
            description: "Relative path within portal (optional, defaults to root)",
          },
          agent_role: {
            type: "string",
            description: "Identity identifier for permission checks",
          },
        },
        required: ["portal", "agent_role"],
      },
    };
  }
}
