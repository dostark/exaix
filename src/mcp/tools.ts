/**
 * @module McpTools
 * @path src/mcp/tools.ts
 * @description Compatibility shim for the package-owned MCP tool assembly module.
 * @architectural-layer MCP
 * @related-files [packages/mcp/server]
 */

import {
  buildDynamicHandlers as buildDynamicHandlersBase,
  buildHandlers as buildHandlersBase,
  LIVE_MCP_TOOL_FACTORIES as LIVE_MCP_TOOL_FACTORIES_BASE,
} from "@exaix/mcp/server";

export const LIVE_MCP_TOOL_FACTORIES = LIVE_MCP_TOOL_FACTORIES_BASE;

export function buildHandlers(...args: Parameters<typeof buildHandlersBase>): ReturnType<typeof buildHandlersBase> {
  return buildHandlersBase(...args);
}

export function buildDynamicHandlers(
  ...args: Parameters<typeof buildDynamicHandlersBase>
): ReturnType<typeof buildDynamicHandlersBase> {
  return buildDynamicHandlersBase(...args);
}
