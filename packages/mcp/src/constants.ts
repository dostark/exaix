/**
 * @module McpConstants
 * @path packages/mcp/src/constants.ts
 * @related-files []
 * @architectural-layer MCP
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
import type { Opt, Reason } from "@exaix/core/types";

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
  entries: Opt<readonly IToolManifestEntry[], Reason.SensibleDefault> = TOOL_MANIFEST,
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

/** Distinct from WRITE_TOOLS and not derivable from it: `exaix_config_set` and
 *  `exaix_config_apply` mutate configuration while declaring `side_effect_scope: none`,
 *  so the read/write split classified them read-only. */
export const APPROVAL_REQUIRED_TOOLS: ReadonlySet<McpToolName> = new Set(
  TOOL_MANIFEST.filter((entry) => isLiveMcpTool(entry) && entry.requires_human_approval)
    .map((entry) => entry.name as McpToolName),
);
