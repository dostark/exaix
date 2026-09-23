/**
 * @module NativeToolTurns
 * @path packages/execution/src/native_tool_turns.ts
 * @description Pure, provider-agnostic transformations for native-tool loops: mapping
 * ToolRegistry's ITool[] to provider IToolDefinition[], building the replay IProviderTurn
 * from a completed tool call, prefixing a portal-relative path param with its `@alias/`,
 * and resolving whether a provider id supports native tool-calling. Shared by
 * ReActLoopStrategy (execution loop) and PlanningToolLoop (planning loop) so the two
 * native-tool loops never drift.
 * @architectural-layer Services
 * @related-files ["packages/execution/src/strategies/react_loop_strategy.ts", "packages/execution/src/planning_tool_loop.ts"]
 */

import type { IProviderTurn, IToolDefinition } from "@exaix/ai/types.ts";
import type { IProviderToolCall } from "@exaix/ai/providers";
import { ProviderRegistry } from "@exaix/ai/provider_registry.ts";
import type { ITool, IToolResult, JSONValue } from "@exaix/core/types";
import { ToolName } from "@exaix/core";
import type { Opt, Reason } from "@exaix/core/types";

/** Maps ToolRegistry's ITool[] to provider-agnostic IToolDefinition[]. Pure transformation
 *  — no I/O, no side effects. */
export function buildNativeToolDefinitions(tools: ITool[]): IToolDefinition[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.nativeDescription ?? t.description,
    inputSchema: t.parameters as never,
  }));
}

/** Builds an IProviderTurn from a completed tool call and its result, forwarding every
 *  provider reasoning artifact (thoughtSignature/thinkingBlocks/reasoningContent) verbatim
 *  so the provider can replay it on the next turn. Pure transformation — no I/O. */
export function buildPriorTurn(toolCall: IProviderToolCall, result: IToolResult): IProviderTurn {
  return {
    toolUseId: toolCall.id,
    toolName: toolCall.name,
    toolInput: toolCall.input,
    toolResultContent: JSON.stringify(result.data ?? result.error ?? {}),
    toolResultIsError: !result.success,
    ...(toolCall.thoughtSignature !== undefined ? { thoughtSignature: toolCall.thoughtSignature } : {}),
    ...(toolCall.thinkingBlocks !== undefined ? { thinkingBlocks: toolCall.thinkingBlocks } : {}),
    ...(toolCall.reasoningContent !== undefined ? { reasoningContent: toolCall.reasoningContent } : {}),
  };
}

/** Prefixes a tool call's `path` param with `@<portalAlias>/` when it isn't already
 *  alias-prefixed. Filesystem tools use a portal alias; `get_module_dependencies`'s cached
 *  graph edges use portal-relative paths and are exempt. Pure transformation — no I/O. */
export function enrichPortalPathParam(
  toolName: string,
  params: Record<string, JSONValue>,
  portalAlias: Opt<string, Reason.OptionalContext>,
): Record<string, JSONValue> {
  const enriched = { ...params };
  if (
    toolName !== ToolName.GET_MODULE_DEPENDENCIES &&
    portalAlias && enriched.path &&
    typeof enriched.path === "string" &&
    !enriched.path.startsWith("@")
  ) {
    enriched.path = `@${portalAlias}/${enriched.path}`;
  }
  return enriched;
}

/** Resolves whether a provider id supports native tool-calling, falling back from a
 *  composite `"<type>-<model>"` id to its bare-type prefix. Never throws. */
export function providerSupportsNativeTools(providerId: Opt<string, Reason.OptionalContext>): boolean {
  if (providerId === undefined) return false;
  if (ProviderRegistry.getProviderMetadata(providerId)?.supportsNativeTools === true) return true;
  const sep = providerId.indexOf("-");
  if (sep === -1) return false;
  return ProviderRegistry.getProviderMetadata(providerId.slice(0, sep))?.supportsNativeTools === true;
}
