/**
 * @module ReadFileTool
 * @path packages-team/mcp-server/handlers/read_file_tool.ts
 * @description Module for ReadFileTool.
 * @architectural-layer MCP
 * @related-files [packages/mcp/server/tool_handler.ts]
 */
import { ToolHandler } from "@exaix/mcp/server";
import type { JSONValue } from "@exaix/core";
import type { MCPToolResponse } from "@exaix/schemas/mcp.ts";
import { ReadFileToolArgsSchema } from "@exaix/schemas/mcp.ts";
import { PortalOperation, ToolErrorCode } from "@exaix/core";
import { McpToolName } from "@exaix/mcp";

/** Reads a portal file; validates portal existence, permission, and path traversal, and journals every read. */
export class ReadFileTool extends ToolHandler {
  async execute(args: Record<string, JSONValue>): Promise<MCPToolResponse> {
    // Validate arguments with Zod schema
    const validatedArgs = ReadFileToolArgsSchema.parse(args);
    const { portal, path, identity_id } = validatedArgs;

    try {
      // All tools make permission checking for portal operations
      this.validatePermission(portal, identity_id, PortalOperation.READ);

      // Validate portal exists
      const portalPath = this.validatePortalExists(portal);

      // Resolve and validate path
      const absolutePath = await this.resolvePortalPath(portalPath, path);

      // Read file
      let content: string;
      try {
        content = await Deno.readTextFile(absolutePath);
      } catch (error) {
        if (error instanceof Deno.errors.NotFound) {
          throw new Error(`File not found: ${path}`);
        }
        throw error;
      }

      // Log successful execution
      this.logToolExecution(McpToolName.READ_FILE, portal, identity_id, {
        path,
        agent_role: identity_id ?? null,
        success: true,
        bytes: content.length,
      });

      return {
        content: [
          {
            type: "text",
            text: content,
          },
        ],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const code = message.startsWith("File not found") ? ToolErrorCode.NOT_FOUND : ToolErrorCode.EXECUTION_FAILED;
      return this.formatToolError(McpToolName.READ_FILE, portal, identity_id, code, message, {
        path,
        agent_role: identity_id ?? null,
      });
    }
  }

  getToolDefinition(): { name: string; description: string; inputSchema: Record<string, JSONValue> } {
    return {
      name: McpToolName.READ_FILE,
      description:
        "Return the full text content of a file inside a portal. Use when you need to read or analyze file contents. For searching within files use run_command with grep or rg; for checking whether a file exists use list_directory. Returns the raw file text as a string.",
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
          agent_role: {
            type: "string",
            description: "Identity identifier for permission checks",
          },
        },
        required: ["portal", "path", "agent_role"],
      },
    };
  }
}
