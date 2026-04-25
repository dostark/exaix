/**
 * @module SearchFilesTool
 * @path src/mcp/handlers/search_files_tool.ts
 * @description MCP tool handler for searching files using glob patterns in a portal.
 * @architectural-layer MCP
 * * @related-files [src/mcp/tool_handler.ts, src/services/tool_registry.ts]
 */
import { ToolHandler } from "../tool_handler.ts";
import { type MCPToolResponse, SearchFilesToolArgsSchema } from "@exaix/schemas/mcp.ts";
import { McpToolName, PortalOperation } from "../../shared/enums.ts";
import type { JSONValue } from "@exaix/core";
import { join } from "@std/path";

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

      // Execute search via ToolRegistry
      const searchPath = path ? join(portalPath, path) : portalPath;

      if (!this.context.toolRegistry) {
        throw new Error("ToolRegistry not available in context");
      }

      // We use the toolRegistry directly from context to leverage existing logic
      const result = await this.context.toolRegistry.execute(McpToolName.SEARCH_FILES, {
        pattern,
        path: searchPath,
      });

      if (!result.success) {
        throw new Error(result.error || "Search failed");
      }

      const files = result.data as { files: string[] };
      // Map absolute paths back to portal-relative paths for the client
      const relativeFiles = files.files.map((f) => f.replace(portalPath, "").replace(/^\//, ""));

      return this.formatSuccess(
        McpToolName.SEARCH_FILES,
        portal,
        identity_id,
        `Found ${relativeFiles.length} files matching '${pattern}'`,
        { pattern, path, count: relativeFiles.length, files: relativeFiles },
      );
    } catch (error) {
      this.formatError(McpToolName.SEARCH_FILES, portal, identity_id, error, { pattern, path });
    }
  }

  getToolDefinition(): {
    name: string;
    description: string;
    inputSchema: Record<string, JSONValue>;
  } {
    return {
      name: McpToolName.SEARCH_FILES,
      description: "Search for files matching a glob pattern (e.g., '**/*.ts')",
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
