/**
 * @module McpConstants
 * @path packages/mcp/src/constants.ts
 * @description MCP defaults plus manifest-derived live tool classification exports.
 */

import {
  DEFAULT_MCP_ENABLED,
  DEFAULT_MCP_HTTP_PORT,
  DEFAULT_MCP_IDENTITY_ID,
  DEFAULT_MCP_SERVER_NAME,
  DEFAULT_MCP_TRANSPORT,
  DEFAULT_MCP_VERSION,
  type McpToolName,
  ToolKind,
  ToolSideEffectScope,
} from "@exaix/core";
import { type IToolManifestEntry, TOOL_MANIFEST } from "./manifest.ts";

export interface IMcpToolClassificationSets {
  readOnlyTools: ReadonlySet<McpToolName>;
  writeTools: ReadonlySet<McpToolName>;
}

export {
  DEFAULT_MCP_ENABLED,
  DEFAULT_MCP_HTTP_PORT,
  DEFAULT_MCP_IDENTITY_ID,
  DEFAULT_MCP_SERVER_NAME,
  DEFAULT_MCP_TRANSPORT,
  DEFAULT_MCP_VERSION,
};

function isLiveMcpTool(entry: IToolManifestEntry): boolean {
  return entry.kind === ToolKind.MCP_HANDLER || entry.kind === ToolKind.MCP_DOMAIN;
}

export function deriveMcpToolClassificationSets(
  entries: readonly IToolManifestEntry[] = TOOL_MANIFEST,
): IMcpToolClassificationSets {
  const readOnlyTools = new Set<McpToolName>();
  const writeTools = new Set<McpToolName>();

  for (const entry of entries) {
    if (!isLiveMcpTool(entry)) {
      continue;
    }

    const targetSet = entry.side_effect_scope === ToolSideEffectScope.NONE ? readOnlyTools : writeTools;
    targetSet.add(entry.name as McpToolName);
  }

  return { readOnlyTools, writeTools };
}

const derivedMcpToolClassificationSets = deriveMcpToolClassificationSets();

export const READ_ONLY_TOOLS = derivedMcpToolClassificationSets.readOnlyTools;
export const WRITE_TOOLS = derivedMcpToolClassificationSets.writeTools;
export const TOTAL_MCP_TOOLS = READ_ONLY_TOOLS.size + WRITE_TOOLS.size;
