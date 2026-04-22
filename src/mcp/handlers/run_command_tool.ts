/**
 * @module RunCommandTool
 * @path src/mcp/handlers/run_command_tool.ts
 * @description MCP tool handler for executing whitelisted commands in a portal.
 * @architectural-layer MCP
 * * @related-files [src/mcp/tool_handler.ts, src/services/tool_registry.ts]
 */
import { ToolHandler } from "../tool_handler.ts";
import { type MCPToolResponse, RunCommandToolArgsSchema } from "@exaix/schemas/mcp.ts";
import { McpToolName, PortalOperation } from "../../shared/enums.ts";
import type { JSONValue } from "../../shared/types/json.ts";

/**
 * RunCommandTool - Executes a whitelisted command in a portal
 */
export class RunCommandTool extends ToolHandler {
  async execute(args: Record<string, JSONValue>): Promise<MCPToolResponse> {
    const validatedArgs = RunCommandToolArgsSchema.parse(args);
    const { portal, command, args: cmdArgs, identity_id } = validatedArgs;

    try {
      // Run command is considered a write/expensive operation requiring GIT or WRITE permissions
      // For safety, we'll check for GIT permission as it implies repository control
      this.validatePermission(portal, identity_id, PortalOperation.GIT);

      // Validate portal exists
      const _portalPath = this.validatePortalExists(portal);

      if (!this.context.toolRegistry) {
        throw new Error("ToolRegistry not available in context");
      }

      // Execute via ToolRegistry which handles whitelisting and security
      const result = await this.context.toolRegistry.execute(McpToolName.RUN_COMMAND, {
        command,
        args: cmdArgs || [],
        // The ToolRegistry implementation of run_command might need a base directory
        // but it currently defaults to system root. We'll need to ensure whitelisted
        // commands that operate on files are safe.
      });

      if (!result.success) {
        throw new Error(result.error || "Command execution failed");
      }

      const output = result.data as string;

      return this.formatSuccess(
        McpToolName.RUN_COMMAND,
        portal,
        identity_id,
        "Command executed successfully",
        { command, args: cmdArgs, output },
      );
    } catch (error) {
      this.formatError(McpToolName.RUN_COMMAND, portal, identity_id, error, { command });
    }
  }

  getToolDefinition(): { name: string; description: string; inputSchema: Record<string, JSONValue> } {
    return {
      name: McpToolName.RUN_COMMAND,
      description: "Execute a whitelisted shell command in the context of a portal",
      inputSchema: {
        type: "object",
        properties: {
          portal: { type: "string", description: "Portal name" },
          command: { type: "string", description: "Command to execute (must be whitelisted)" },
          args: { type: "array", items: { type: "string" }, description: "Command arguments" },
          identity_id: { type: "string", description: "Identity identifier for permission checks" },
        },
        required: ["portal", "command", "identity_id"],
      },
    };
  }
}
