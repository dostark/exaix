/**
 * @module McpToolCallCanonicalizer
 * @path packages/mcp/server/mcp_tool_call_canonicalizer.ts
 * @description Shared name and argument canonicalization for every MCP dispatch path (legacy
 *   JSON-RPC, Streamable HTTP ingress, SDK callbacks, local dispatch). A general-purpose alias
 *   resolves to a registered canonical handler. Native names stay exact. Arguments normalize
 *   against the selected handler's own input schema, minus auth-only keys.
 * @architectural-layer MCP
 * @dependencies [@exaix/core]
 * @related-files [packages/core/src/types/tool_aliases.ts, packages/mcp/server/local_tool_dispatcher.ts, exaix-team/packages/mcp-server/server.ts]
 */

import { canonicalizeToolCall, canonicalizeToolName, TOOL_AUTH_ONLY_PARAMS, ToolCallEntryPoint } from "@exaix/core";
import type { ICanonicalizedToolCall, JSONValue } from "@exaix/core";
import type { IToolAliasRewrittenPayload } from "@exaix/core/events";
import type { Opt, Reason } from "@exaix/core/types";

/** The part of an MCP tool handler this module reads. */
export interface IMcpToolSchemaSource {
  getToolDefinition(): { name: string; inputSchema: Record<string, JSONValue> };
}

/** A tool call resolved to a registered handler, with canonical name and arguments. */
export interface IResolvedMcpToolCall<T> {
  handler: T;
  call: ICanonicalizedToolCall;
}

/** The parameter keys a handler declares, excluding auth-only keys. */
export function mcpAcceptedParams(source: IMcpToolSchemaSource): ReadonlySet<string> {
  const properties = source.getToolDefinition().inputSchema.properties;
  const keys = properties !== null && typeof properties === "object" && !Array.isArray(properties)
    ? Object.keys(properties)
    : [];
  return new Set(keys.filter((key) => !TOOL_AUTH_ONLY_PARAMS.includes(key)));
}

/** The registered canonical name for `name`, or undefined when no handler matches. */
export function resolveMcpToolName<T>(tools: ReadonlyMap<string, T>, name: string): Opt<string, Reason.OptionalInput> {
  const canonical = canonicalizeToolName(name);
  return tools.has(canonical) ? canonical : undefined;
}

/** Canonicalizes arguments for a resolved handler.
 *  The original alias in `requestedName` merges name and parameter rewrites into one record. */
export function canonicalizeMcpArguments(
  handler: IMcpToolSchemaSource,
  requestedName: Opt<string, Reason.OptionalInput>,
  canonicalName: string,
  args: Record<string, JSONValue>,
): ICanonicalizedToolCall {
  const call = canonicalizeToolCall(requestedName ?? canonicalName, args, mcpAcceptedParams(handler));
  return { ...call, name: canonicalName };
}

/** Resolves a tool name to a registered handler and canonicalizes its arguments. */
export function canonicalizeMcpToolCall<T extends IMcpToolSchemaSource>(
  tools: ReadonlyMap<string, T>,
  requestedName: string,
  args: Record<string, JSONValue>,
): Opt<IResolvedMcpToolCall<T>, Reason.OptionalInput> {
  const canonical = resolveMcpToolName(tools, requestedName);
  if (canonical === undefined) return undefined;
  const handler = tools.get(canonical)!;
  return { handler, call: canonicalizeMcpArguments(handler, requestedName, canonical, args) };
}

/** The `tool.alias.rewritten` payload for an MCP call. */
export function mcpAliasRewrittenPayload(call: ICanonicalizedToolCall): IToolAliasRewrittenPayload {
  return {
    requestedName: call.requestedName,
    canonicalName: call.name,
    renamedParams: [...call.renamedParams],
    droppedParams: [...call.droppedParams],
    entryPoint: ToolCallEntryPoint.MCP,
  };
}
