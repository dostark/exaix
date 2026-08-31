/**
 * @module PatchFileTool
 * @path packages-team/mcp-server/handlers/patch_file_tool.ts
 * @description MCP tool handler for applying targeted string replacements to portal files.
 * Preferred over write_file for code edits — produces minimal, auditable changes.
 * @architectural-layer MCP
 * @related-files [packages/mcp/server/tool_handler.ts, packages-team/mcp-server/handlers/write_file_tool.ts]
 */
import { ToolHandler } from "@exaix/mcp/server";
import { type MCPToolResponse, PatchFileToolArgsSchema } from "@exaix/schemas/mcp.ts";
import { PortalOperation, ToolErrorCode } from "@exaix/core";
import { McpToolName } from "@exaix/mcp";
import type { JSONValue } from "@exaix/core";

/** Fails loudly (rather than silently no-op) if the search string is not found or
 *  matches more than once. */
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

    try {
      this.validatePermission(portal, identity_id, PortalOperation.WRITE);

      const portalPath = this.validatePortalExists(portal);
      const absolutePath = await this.resolvePortalPath(portalPath, path);

      // Read existing content
      let content: string;
      try {
        content = await Deno.readTextFile(absolutePath);
      } catch {
        throw new Error(`File not found: ${path}`);
      }

      // Count occurrences — must be exactly one
      const segments = content.split(search);
      const occurrences = segments.length - 1;

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

      // Array.prototype.join writes `replace` literally — unlike String.prototype.replace(),
      // it never interprets $&/$`/$'/$$/$<digit> substitution patterns in the replacement text
      // (Phase 154 GAP-6).
      const patched = segments.join(replace);
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
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      let code = ToolErrorCode.EXECUTION_FAILED;
      if (message.startsWith("File not found")) code = ToolErrorCode.NOT_FOUND;
      if (message.includes("not found in") || message.includes("times in")) code = ToolErrorCode.INVALID_ARGS;
      return this.formatToolError(McpToolName.PATCH_FILE, portal, identity_id, code, message, { path });
    }
  }

  getToolDefinition(): { name: string; description: string; inputSchema: Record<string, JSONValue> } {
    return {
      name: McpToolName.PATCH_FILE,
      description:
        "Apply a targeted patch to replace a specific substring in a file without rewriting the whole file. Use when you need to make a minimal change. For full rewrites use write_file. Returns a success confirmation message.",
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
