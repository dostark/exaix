/**
 * @module ListDirectoryTool
 * @path src/mcp/handlers/list_directory_tool.ts
 * @description MCP tool handler for listing directory contents in a portal with security validation.
 * @architectural-layer MCP
 * * @related-files [src/mcp/tool_handler.ts]
 */
import { ToolHandler } from "../tool_handler.ts";
import { ListDirectoryToolArgsSchema, type MCPToolResponse } from "@exaix/schemas/mcp.ts";
import { McpToolName, PortalOperation } from "../../shared/enums.ts";
import type { JSONValue } from "../../shared/types/json.ts";

/**
 * ListDirectoryTool - Lists files and directories in a portal path
 *
 * Security:
 * - Validates portal exists
 * - Prevents path traversal
 * - Returns structured directory listing
 * - Logs all operations to IActivity Journal
 */
export class ListDirectoryTool extends ToolHandler {
  async execute(args: Record<string, JSONValue>): Promise<MCPToolResponse> {
    const validatedArgs = ListDirectoryToolArgsSchema.parse(args) as {
      portal: string;
      path?: string;
      identity_id: string;
    };
    const { portal, path, identity_id } = validatedArgs;

    try {
      // All tools make permission checking for portal operations
      this.validatePermission(portal, identity_id, PortalOperation.READ);

      // Validate portal exists
      const portalPath = this.validatePortalExists(portal);

      // Resolve and validate path (defaults to portal root)
      const listPath = path || "";
      const absolutePath = this.resolvePortalPath(portalPath, listPath);

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
        identity_id: identity_id ?? null,
        success: true,
        entry_count: entries.length,
      });

      return {
        content: [
          {
            type: "text",
            text: listing,
          },
        ],
      };
    } catch (error) {
      // Log failed execution
      this.logToolExecution(McpToolName.LIST_DIRECTORY, portal, identity_id, {
        path: path || "/",
        identity_id: identity_id ?? null,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });

      throw error;
    }
  }

  getToolDefinition(): { name: string; description: string; inputSchema: Record<string, JSONValue> } {
    return {
      name: McpToolName.LIST_DIRECTORY,
      description: "List files and directories in a portal path",
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
          identity_id: {
            type: "string",
            description: "Identity identifier for permission checks",
          },
        },
        required: ["portal", "identity_id"],
      },
    };
  }
}
