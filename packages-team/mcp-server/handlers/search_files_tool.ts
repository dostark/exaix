/**
 * @module SearchFilesTool
 * @path packages-team/mcp-server/handlers/search_files_tool.ts
 * @description MCP tool handler for searching files using glob patterns in a portal.
 * @architectural-layer MCP
 * @related-files [packages/mcp/server/tool_handler.ts, "packages/tool-runtime/src/tool_registry.ts"]
 */
import { ToolHandler } from "@exaix/mcp/server";
import { toolResultToMcpResponse } from "@exaix/mcp";
import { type MCPToolResponse, SearchFilesToolArgsSchema } from "@exaix/schemas/mcp.ts";
import { PortalOperation, ToolErrorCode } from "@exaix/core";
import { McpToolName } from "@exaix/mcp";
import type { JSONValue } from "@exaix/core";

/**
 * SearchFilesTool - Searches for files matching a glob pattern
 */
export class SearchFilesTool extends ToolHandler {
  async execute(args: Record<string, JSONValue>): Promise<MCPToolResponse> {
    const validatedArgs = SearchFilesToolArgsSchema.parse(args);
    const { portal, pattern, path, identity_id } = validatedArgs;

    try {
      // Validate permissions
      this.validatePermission(portal, identity_id, PortalOperation.READ);

      // Validate portal exists
      const portalPath = this.validatePortalExists(portal);

      // Resolve against the single authorized portal via the canonical per-portal resolver,
      // so a "path": ".." (or symlink) traversal can never leave the caller's portal even
      // though ToolRegistry's own allowed-roots list is intentionally global.
      const searchPath = path ? await this.resolvePortalPath(portalPath, path) : portalPath;

      if (!this.context.toolRegistry) {
        throw new Error("ToolRegistry not available in context");
      }

      // We use the toolRegistry directly from context to leverage existing logic
      const result = await this.context.toolRegistry.execute(McpToolName.SEARCH_FILES, {
        pattern,
        path: searchPath,
      });

      if (!result.success) {
        return this.formatToolError(
          McpToolName.SEARCH_FILES,
          portal,
          identity_id,
          ToolErrorCode.EXECUTION_FAILED,
          result.error || "Search failed",
          { pattern, path },
        );
      }

      const files = result.data as { files: string[] };
      const relativeFiles = files.files.map((f) => f.replace(portalPath, "").replace(/^\//, ""));
      this.logToolExecution(McpToolName.SEARCH_FILES, portal, identity_id, {
        pattern,
        path,
        count: relativeFiles.length,
        success: true,
      });
      return toolResultToMcpResponse({ success: true, data: { files: relativeFiles } });
    } catch (error) {
      return this.formatToolError(
        McpToolName.SEARCH_FILES,
        portal,
        identity_id,
        ToolErrorCode.EXECUTION_FAILED,
        error instanceof Error ? error.message : String(error),
        { pattern, path },
      );
    }
  }

  getToolDefinition(): {
    name: string;
    description: string;
    inputSchema: Record<string, JSONValue>;
  } {
    return {
      name: McpToolName.SEARCH_FILES,
      description:
        "Search for files matching a name or glob pattern inside a portal. Use to locate files when you don't know the exact path. For content search within files use run_command with grep or rg. Returns an array of matching relative file paths.",
      inputSchema: {
        type: "object",
        properties: {
          portal: { type: "string", description: "Portal name" },
          pattern: { type: "string", description: "Glob pattern to match" },
          path: { type: "string", description: "Optional: subdirectory to search in" },
          identity_id: { type: "string", description: "Identity identifier for permission checks" },
        },
        required: ["portal", "pattern", "identity_id"],
      },
    };
  }
}
