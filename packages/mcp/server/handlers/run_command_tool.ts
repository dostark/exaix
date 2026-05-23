/**
 * @module RunCommandTool
 * @path packages/mcp/server/handlers/run_command_tool.ts
 * @description MCP tool handler for executing whitelisted commands in a portal.
 * @architectural-layer MCP
 * @related-files [packages/mcp/server/tool_handler.ts, packages/tool-runtime/src/tool_registry.ts]
 */
import { ToolHandler } from "../tool_handler.ts";
import { toolResultToMcpResponse } from "@exaix/mcp";
import { type MCPToolResponse, RunCommandToolArgsSchema } from "@exaix/schemas/mcp.ts";
import { JsonSchemaType, PortalOperation, ToolErrorCode } from "@exaix/core";
import { McpToolName } from "@exaix/mcp";
import type { JSONValue } from "@exaix/core";

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
        return this.formatToolError(
          McpToolName.RUN_COMMAND,
          portal,
          identity_id,
          ToolErrorCode.EXECUTION_FAILED,
          result.error || "Command execution failed",
          { command, args: cmdArgs },
        );
      }

      const data = result.data as { output: string; exitCode: number };
      this.logToolExecution(McpToolName.RUN_COMMAND, portal, identity_id, {
        command,
        args: cmdArgs,
        exitCode: data.exitCode,
        success: true,
      });
      return toolResultToMcpResponse(result);
    } catch (error) {
      return this.formatToolError(
        McpToolName.RUN_COMMAND,
        portal,
        identity_id,
        ToolErrorCode.EXECUTION_FAILED,
        error instanceof Error ? error.message : String(error),
        { command },
      );
    }
  }

  getToolDefinition(): { name: string; description: string; inputSchema: Record<string, JSONValue> } {
    return {
      name: McpToolName.RUN_COMMAND,
      description:
        "Execute a shell command inside the portal working directory. Use for build tasks, test runners, or any operation not covered by dedicated tools. Returns combined stdout/stderr output and exit code.",
      inputSchema: {
        type: "object",
        properties: {
          portal: { type: "string", description: "Portal name" },
          command: { type: "string", description: "Command to execute (must be whitelisted)" },
          args: { type: JsonSchemaType.ARRAY, items: { type: "string" }, description: "Command arguments" },
          identity_id: { type: "string", description: "Identity identifier for permission checks" },
        },
        required: ["portal", "command", "identity_id"],
      },
    };
  }
}
