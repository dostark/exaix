/**
 * @module PatchFileTool
 * @path src/mcp/handlers/patch_file_tool.ts
 * @description MCP tool handler for applying targeted string replacements to portal files.
 * Preferred over write_file for code edits — produces minimal, auditable changes.
 * @architectural-layer MCP
 * * @related-files [src/mcp/tool_handler.ts, src/mcp/handlers/write_file_tool.ts]
 */
import { ToolHandler } from "../tool_handler.ts";
import { type MCPToolResponse, PatchFileToolArgsSchema } from "@exaix/schemas/mcp.ts";
import { McpToolName, PortalOperation } from "../../shared/enums.ts";
import type { JSONValue } from "../../shared/types/json.ts";

/**
 * PatchFileTool — applies an exact string replacement within a portal file.
 *
 * Security:
 * - Validates portal exists
 * - Prevents path traversal
 * - Requires PortalOperation.WRITE permission
 * - Fails loudly if search string not found or is ambiguous (multiple matches)
 * - Logs all patch operations to Activity Journal
 */
export class PatchFileTool extends ToolHandler {
  async execute(args: Record<string, JSONValue>): Promise<MCPToolResponse> {
    const validatedArgs = PatchFileToolArgsSchema.parse(args) as {
      portal: string;
      path: string;
      search: string;
      replace: string;
      identity_id: string;
    };
    const { portal, path, search, replace, identity_id } = validatedArgs;

    this.validatePermission(portal, identity_id, PortalOperation.WRITE);

    const portalPath = this.validatePortalExists(portal);
    const absolutePath = this.resolvePortalPath(portalPath, path);

    // Read existing content
    let content: string;
    try {
      content = await Deno.readTextFile(absolutePath);
    } catch {
      throw new Error(`File not found: ${path}`);
    }

    // Count occurrences — must be exactly one
    const occurrences = content.split(search).length - 1;

    if (occurrences === 0) {
      throw new Error(
        `patch_file: search string not found in "${path}". ` +
          `Verify the exact text exists in the file (whitespace and indentation must match).`,
      );
    }

    if (occurrences > 1) {
      throw new Error(
        `patch_file: search string found ${occurrences} times in "${path}". ` +
          `Make the search string more specific to match exactly one location.`,
      );
    }

    // Apply replacement
    const patched = content.replace(search, replace);
    await Deno.writeTextFile(absolutePath, patched);

    this.logToolExecution(McpToolName.PATCH_FILE, portal, identity_id, {
      path,
      search_length: search.length,
      replace_length: replace.length,
      bytes_before: content.length,
      bytes_after: patched.length,
      success: true,
    });

    return {
      content: [
        {
          type: "text",
          text: `patch_file success on ${path}. Changed from ${content.length} to ${patched.length} bytes.`,
        },
      ],
    };
  }

  getToolDefinition(): { name: string; description: string; inputSchema: Record<string, JSONValue> } {
    return {
      name: McpToolName.PATCH_FILE,
      description: "Apply a targeted string replacement to a file in a portal. " +
        "Preferred over write_file for code edits — only the changed section is specified. " +
        "The search string must match exactly once; fails if not found or ambiguous.",
      inputSchema: {
        type: "object",
        properties: {
          portal: {
            type: "string",
            description: "Portal alias to operate on",
          },
          path: {
            type: "string",
            description: "File path relative to portal root",
          },
          search: {
            type: "string",
            description: "Exact string to find in the file (including whitespace/indentation). " +
              "Must match exactly once.",
          },
          replace: {
            type: "string",
            description: "Replacement string. Use empty string to delete the matched section.",
          },
          identity_id: {
            type: "string",
            description: "Identity identifier for permission checks",
          },
        },
        required: ["portal", "path", "search", "replace", "identity_id"],
      },
    };
  }
}
