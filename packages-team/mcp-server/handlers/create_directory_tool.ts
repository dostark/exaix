/**
 * @module CreateDirectoryTool
 * @path packages-team/mcp-server/handlers/create_directory_tool.ts
 * @description MCP tool handler for creating a directory tree within a portal.
 * Low-risk altering operation — creates parent directories recursively.
 * @architectural-layer MCP
 * @related-files [packages/mcp/server/tool_handler.ts]
 */
import { ToolHandler } from "@exaix/mcp/server";
import { CreateDirectoryToolArgsSchema, type MCPToolResponse } from "@exaix/schemas/mcp.ts";
import { PortalOperation } from "@exaix/core";
import { McpToolName } from "@exaix/mcp";
import type { JSONValue } from "@exaix/core";

/** Idempotent — no-op if the directory already exists. */
export class CreateDirectoryTool extends ToolHandler {
  async execute(args: Record<string, JSONValue>): Promise<MCPToolResponse> {
    const validatedArgs = CreateDirectoryToolArgsSchema.parse(args) as {
      portal: string;
      path: string;
      agent_role: string;
    };
    const { portal, path, agent_role } = validatedArgs;

    this.validatePermission(portal, agent_role, PortalOperation.WRITE);

    const portalPath = this.validatePortalExists(portal);
    const absolutePath = await this.resolvePortalPath(portalPath, path);

    await Deno.mkdir(absolutePath, { recursive: true });

    this.logToolExecution(McpToolName.CREATE_DIRECTORY, portal, agent_role, {
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
      description:
        "Create a directory (and any missing parent directories) inside a portal. Use before writing files into a directory that may not exist yet. Safe to call if the directory already exists. Returns a success confirmation message.",
      inputSchema: {
        type: "object",
        properties: {
          portal: { type: "string", description: "Portal alias" },
          path: { type: "string", description: "Directory path relative to portal root" },
          agent_role: { type: "string", description: "Agent role identifier for permission checks" },
        },
        required: ["portal", "path", "agent_role"],
      },
    };
  }
}
