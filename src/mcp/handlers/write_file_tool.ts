/**
 * @module WriteFileTool
 * @path src/mcp/handlers/write_file_tool.ts
 * @description MCP tool handler for writing files to a portal with security validation and path safety.
 * @architectural-layer MCP
 * * @related-files [src/mcp/tool_handler.ts]
 */
import { ToolHandler } from "../tool_handler.ts";
import { type MCPToolResponse, WriteFileToolArgsSchema } from "../../shared/schemas/mcp.ts";
import { McpToolName, PortalOperation } from "../../shared/enums.ts";
import { dirname } from "@std/path";
import type { JSONValue } from "../../shared/types/json.ts";

/**
 * WriteFileTool - Writes file content to a portal
 *
 * Security:
 * - Validates portal exists
 * - Prevents path traversal
 * - Creates parent directories if needed
 * - Logs all writes to IActivity Journal
 */
export class WriteFileTool extends ToolHandler {
  async execute(args: Record<string, JSONValue>): Promise<MCPToolResponse> {
    const validatedArgs = WriteFileToolArgsSchema.parse(args) as {
      portal: string;
      path: string;
      content: string;
      identity_id: string;
    };
    const { portal, path, content, identity_id } = validatedArgs;

    try {
      // All tools make permission checking for portal operations
      this.validatePermission(portal, identity_id, PortalOperation.WRITE);

      // Validate portal exists
      const portalPath = this.validatePortalExists(portal);

      // Resolve and validate path
      const absolutePath = this.resolvePortalPath(portalPath, path);

      // Create parent directories if needed
      const parentDir = dirname(absolutePath);
      await Deno.mkdir(parentDir, { recursive: true });

      // Write file
      await Deno.writeTextFile(absolutePath, content);

      // Log successful execution
      this.logToolExecution(McpToolName.WRITE_FILE, portal, identity_id, {
        path,
        identity_id: identity_id ?? null,
        success: true,
        bytes: content.length,
      });

      return {
        content: [
          {
            type: "text",
            text: `File written successfully: ${path} (${content.length} bytes)`,
          },
        ],
      };
    } catch (error) {
      // Log failed execution
      this.logToolExecution(McpToolName.WRITE_FILE, portal, identity_id, {
        path,
        identity_id: identity_id ?? null,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });

      throw error;
    }
  }

  getToolDefinition(): { name: string; description: string; inputSchema: Record<string, JSONValue> } {
    return {
      name: McpToolName.WRITE_FILE,
      description: "Write a file to a portal (validated and logged)",
      inputSchema: {
        type: "object",
        properties: {
          portal: {
            type: "string",
            description: "Portal name",
          },
          path: {
            type: "string",
            description: "Relative path within portal",
          },
          content: {
            type: "string",
            description: "File content to write",
          },
          identity_id: {
            type: "string",
            description: "Identity identifier for permission checks",
          },
        },
        required: ["portal", "path", "content", "identity_id"],
      },
    };
  }
}
