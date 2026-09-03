/**
 * @module PortalKnowledgeTools
 * @path packages-team/mcp-server/portal_knowledge_tools.ts
 * @description Exposes persisted portal knowledge (AST-derived code symbols) as a strictly
 * typed MCP tool. `PortalKnowledgeService` strategy 6 (symbol extraction) already computes and
 * persists a `symbolMap` to `Memory/Projects/<alias>/knowledge.json`, but until this tool it was
 * display-only (CLI/TUI), with no agent-facing read path (see GitHub issue #3).
 * @architectural-layer MCP
 * @related-files [packages-team/mcp-server/server.ts, packages-team/mcp-server/tools.ts, packages/portal/knowledge/knowledge_persistence.ts, "packages/portal/knowledge/portal_knowledge_service.ts"]
 */
import { join } from "@std/path";
import { loadKnowledge } from "@exaix/portal/knowledge";
import { type MCPToolResponse, PortalSymbolsToolArgsSchema } from "@exaix/schemas/mcp.ts";
import { ToolHandler } from "@exaix/mcp/server";
import { McpToolName } from "@exaix/mcp";
import {
  DEFAULT_PROJECTS_MEMORY_PATH,
  type JSONValue,
  MCP_CONTENT_TYPE_STRUCTURED_DATA,
  PortalOperation,
  ToolErrorCode,
} from "@exaix/core";

function classifyPortalKnowledgeToolError(message: string): ToolErrorCode {
  const lower = message.toLowerCase();
  if (lower.includes("not found") || lower.includes("no such") || lower.includes("has not been analyzed")) {
    return ToolErrorCode.NOT_FOUND;
  }
  if (lower.includes("invalid") || lower.includes("required") || lower.includes("must")) {
    return ToolErrorCode.INVALID_ARGS;
  }
  return ToolErrorCode.EXECUTION_FAILED;
}

/** Queries AST-derived symbols already extracted into a portal's persisted knowledge by
 *  `portal analyze` — read-only, does not run extraction itself. */
export class PortalSymbolsTool extends ToolHandler {
  async execute(args: Record<string, JSONValue>): Promise<MCPToolResponse> {
    const validatedArgs = PortalSymbolsToolArgsSchema.parse(args);
    const { portal, query, kind, limit, agent_role } = validatedArgs;

    try {
      this.validatePermission(portal, agent_role, PortalOperation.READ);
      this.validatePortalExists(portal);

      const projectsDir = join(
        this.config.system.root as string,
        this.config.paths.memory as string,
        DEFAULT_PROJECTS_MEMORY_PATH,
      );
      const knowledge = await loadKnowledge(portal, projectsDir);
      if (!knowledge) {
        throw new Error(
          `Portal '${portal}' has not been analyzed — no code symbols are available. ` +
            `Run 'exactl portal analyze ${portal} --mode standard' first.`,
        );
      }

      const queryLower = query?.toLowerCase();
      const symbols = knowledge.symbolMap
        .filter((symbol) =>
          (!queryLower || symbol.name.toLowerCase().includes(queryLower)) && (!kind || symbol.kind === kind)
        )
        .sort((a, b) => (b.pageRankScore ?? 0) - (a.pageRankScore ?? 0))
        .slice(0, limit);

      this.logToolExecution(McpToolName.PORTAL_SYMBOLS, portal, agent_role, {
        query: query ?? null,
        kind: kind ?? null,
        limit,
        agent_role,
        matched: symbols.length,
        total: knowledge.symbolMap.length,
        success: true,
      });

      return {
        content: [
          { type: "text", text: JSON.stringify(symbols, null, 2) },
          { type: MCP_CONTENT_TYPE_STRUCTURED_DATA, data: JSON.parse(JSON.stringify(symbols)) as JSONValue },
        ],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return this.formatToolError(
        McpToolName.PORTAL_SYMBOLS,
        portal,
        agent_role,
        classifyPortalKnowledgeToolError(message),
        message,
        {
          query: query ?? null,
          kind: kind ?? null,
          agent_role,
        },
      );
    }
  }

  getToolDefinition(): { name: string; description: string; inputSchema: Record<string, JSONValue> } {
    return {
      name: McpToolName.PORTAL_SYMBOLS,
      description:
        "List code symbols (functions, classes, interfaces, consts, types, enums) previously extracted from a portal's codebase by 'portal analyze' (standard/deep mode). Read-only; safe for dynamic execution. Use to navigate an unfamiliar codebase, find a symbol's file and signature, or discover what a portal exports without reading whole files. Optionally filter by a case-insensitive name substring (query) or symbol kind, and cap result count (limit). Returns an error if the portal has not been analyzed yet — run 'portal analyze' first. Returns an array of symbol records ranked by connectivity (pageRankScore, most-referenced first).",
      inputSchema: {
        type: "object",
        properties: {
          portal: {
            type: "string",
            description: "Portal alias to query",
          },
          query: {
            type: "string",
            description: "Case-insensitive substring filter on symbol name",
          },
          kind: {
            type: "string",
            enum: ["function", "class", "interface", "const", "type", "enum"],
            description: "Filter by symbol kind",
          },
          limit: {
            type: "number",
            description: "Max symbols to return (default: 50)",
          },
          agent_role: {
            type: "string",
            description: "Identity identifier for permission checks",
          },
        },
        required: ["portal", "agent_role"],
      },
    };
  }
}
