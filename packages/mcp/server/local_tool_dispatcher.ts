/**
 * @module LocalToolDispatcher
 * @path packages/mcp/server/local_tool_dispatcher.ts
 * @description Wrapper around existing MCP tool execution, providing the IMcpClient interface.
 * @architectural-layer MCP
 * @related-files [packages/mcp/server/tool_handler.ts, packages/flow/src/dynamic_step_executor.ts]
 */
import type { ToolArgs } from "@exaix/ai";
import type { IMcpClient } from "../src/i_mcp_client.ts";
import { appendToolChoiceHint, TOOL_MANIFEST } from "@exaix/mcp";
import type { McpToolName } from "@exaix/mcp";
import type { ToolHandler } from "./tool_handler.ts";
import type { IApplicationContext, IToolManifestResolver, Opt, Reason } from "@exaix/core/types";
import { canonicalizeToolName, type JSONValue } from "@exaix/core";
import type { IEventLogger } from "@exaix/core/logger";
import { DomainEventType } from "@exaix/core/events";
import {
  canonicalizeMcpToolCall,
  mcpAliasRewrittenPayload,
  resolveMcpToolName,
} from "./mcp_tool_call_canonicalizer.ts";

/** Not an MCP protocol client — dispatches locally to Exaix's own tool handlers. For a
 *  real outbound MCP connection, see `packages/mcp/src/external_mcp_client.ts`. */
export class LocalToolDispatcher implements IMcpClient, IToolManifestResolver {
  private readonly tools: Map<string, ToolHandler>;

  constructor(
    private readonly context: IApplicationContext,
    handlers: ToolHandler[] | Map<string, ToolHandler>,
    private readonly logger?: Opt<IEventLogger, Reason.OptionalDependency>,
  ) {
    if (handlers instanceof Map) {
      this.tools = new Map(handlers as Map<string, ToolHandler>);
    } else {
      this.tools = new Map<string, ToolHandler>();
      for (const handler of handlers) {
        const def = handler.getToolDefinition();
        this.tools.set(def.name, handler);
      }
    }
  }

  /** Returns the names of all tool handlers registered in this client. */
  getAvailableToolNames(): McpToolName[] {
    return [...this.tools.keys()] as McpToolName[];
  }

  async callTool(tool: McpToolName, args: ToolArgs): Promise<string> {
    const resolved = canonicalizeMcpToolCall(this.tools, tool, args as Record<string, JSONValue>);
    if (!resolved) {
      throw new Error(`MCP Tool '${tool}' not found in registry`);
    }
    if (resolved.call.rewritten) {
      const payload = mcpAliasRewrittenPayload(resolved.call);
      await this.logger?.info(DomainEventType.ToolAliasRewritten, resolved.call.name, { ...payload });
    }

    const response = await resolved.handler.execute(resolved.call.params);
    return response.content
      .filter((c) => c.type === "text")
      .map((c) => (c as { type: string; text: string }).text)
      .join("\n");
  }

  requiresHumanApproval(tool: McpToolName): boolean {
    const canonical = canonicalizeToolName(tool);
    return TOOL_MANIFEST.find((e) => e.name === canonical)?.requires_human_approval ?? false;
  }

  getToolDefinitions(tools: McpToolName[]): Array<{
    name: string;
    description: string;
    inputSchema: Record<string, JSONValue>;
  }> {
    return tools
      .map((t) => this.tools.get(resolveMcpToolName(this.tools, t) ?? t))
      .filter((h): h is ToolHandler => !!h)
      .map((h) => {
        const definition = h.getToolDefinition();
        return { ...definition, description: appendToolChoiceHint(definition.name, definition.description) };
      });
  }
}
