/**
 * @module CreateDirectoryTool
 * @path src/mcp/handlers/create_directory_tool.ts
 * @description MCP tool handler for creating a directory tree within a portal.
 * Low-risk altering operation — creates parent directories recursively.
 * @architectural-layer MCP
 * * @related-files [src/mcp/tool_handler.ts]
 */
import { ToolHandler } from "../tool_handler.ts";
import { CreateDirectoryToolArgsSchema, type MCPToolResponse } from "@exaix/schemas/mcp.ts";
import { PortalOperation } from "@exaix/core";
import { McpToolName } from "@exaix/mcp";
import type { JSONValue } from "@exaix/core";

/**
 * CreateDirectoryTool — creates a directory (and all parent directories) within a portal.
 *
 * Security:
 * - Validates portal exists
 * - Prevents path traversal
 * - Requires PortalOperation.WRITE permission
 * - Idempotent: succeeds silently if directory already exists
 * - Logs to Activity Journal
 */
export class CreateDirectoryTool extends ToolHandler {
  async execute(args: Record<string, JSONValue>): Promise<MCPToolResponse> {
    const validatedArgs = CreateDirectoryToolArgsSchema.parse(args) as {
      portal: string;
      path: string;
      identity_id: string;
    };
    const { portal, path, identity_id } = validatedArgs;

    this.validatePermission(portal, identity_id, PortalOperation.WRITE);

    const portalPath = this.validatePortalExists(portal);
    const absolutePath = this.resolvePortalPath(portalPath, path);

    await Deno.mkdir(absolutePath, { recursive: true });

    this.logToolExecution(McpToolName.CREATE_DIRECTORY, portal, identity_id, {
      path,
      success: true,
    });

    return {
      content: [
        {
          type: "text",
          text: `create_directory success on ${path}.`,
        },
      ],
    };
  }

  getToolDefinition(): { name: string; description: string; inputSchema: Record<string, JSONValue> } {
    return {
      name: McpToolName.CREATE_DIRECTORY,
      description: "Create a directory (and all required parent directories) within a portal. " +
        "Idempotent — succeeds silently if the directory already exists.",
      inputSchema: {
        type: "object",
        properties: {
          portal: { type: "string", description: "Portal alias" },
          path: { type: "string", description: "Directory path relative to portal root" },
          identity_id: { type: "string", description: "Identity identifier for permission checks" },
        },
        required: ["portal", "path", "identity_id"],
      },
    };
  }
}
