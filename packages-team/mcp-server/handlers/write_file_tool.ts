/**
 * @module WriteFileTool
 * @path packages-team/mcp-server/handlers/write_file_tool.ts
 * @description MCP tool handler for writing files to a portal with security validation and path safety.
 * @architectural-layer MCP
 * @related-files [packages/mcp/server/tool_handler.ts]
 */
import { ToolHandler } from "@exaix/mcp/server";
import { type MCPToolResponse, WriteFileToolArgsSchema } from "@exaix/schemas/mcp.ts";
import { PortalOperation } from "@exaix/core";
import { McpToolName } from "@exaix/mcp";
import { dirname } from "@std/path";
import type { JSONValue } from "@exaix/core";

/** Prevents path traversal, creates parent directories as needed, and logs all writes to the Activity Journal. */
export class WriteFileTool extends ToolHandler {
  async execute(args: Record<string, JSONValue>): Promise<MCPToolResponse> {
    const validatedArgs = WriteFileToolArgsSchema.parse(args) as {
      portal: string;
      path: string;
      content: string;
      agent_role: string;
    };
    const { portal, path, content, agent_role } = validatedArgs;

    try {
      // All tools make permission checking for portal operations
      this.validatePermission(portal, agent_role, PortalOperation.WRITE);

      // Validate portal exists
      const portalPath = this.validatePortalExists(portal);

      // Resolve and validate path
      const absolutePath = await this.resolvePortalPath(portalPath, path);

      // Create parent directories if needed
      const parentDir = dirname(absolutePath);
      await Deno.mkdir(parentDir, { recursive: true });

      // Write file
      await Deno.writeTextFile(absolutePath, content);

      // Log successful execution
      this.logToolExecution(McpToolName.WRITE_FILE, portal, agent_role, {
        path,
        agent_role: agent_role ?? null,
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
      this.logToolExecution(McpToolName.WRITE_FILE, portal, agent_role, {
        path,
        agent_role: agent_role ?? null,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });

      throw error;
    }
  }

  getToolDefinition(): { name: string; description: string; inputSchema: Record<string, JSONValue> } {
    return {
      name: McpToolName.WRITE_FILE,
      description:
        "Write or overwrite the full content of a file inside a portal. Use when you need to create a new file or completely replace an existing file. For partial edits use patch_file. Returns a success confirmation message.",
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
          agent_role: {
            type: "string",
            description: "Agent role identifier for permission checks",
          },
        },
        required: ["portal", "path", "content", "agent_role"],
      },
    };
  }
}
