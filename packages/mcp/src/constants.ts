/**
 * @module McpConstants
 * @path packages/mcp/src/constants.ts
 * @related-files []
 * @architectural-layer MCP
 * @description Manifest-derived live tool classification sets.
 */

import { type McpToolName, ToolKind, ToolSideEffectScope } from "@exaix/core";
import { type IToolManifestEntry, TOOL_MANIFEST } from "./manifest.ts";
import type { Opt, Reason } from "@exaix/core/types";

interface IMcpToolClassificationSets {
  readOnlyTools: ReadonlySet<McpToolName>;
  writeTools: ReadonlySet<McpToolName>;
}

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
/** Distinct from WRITE_TOOLS and not derivable from it: `exaix_config_set` and
 *  `exaix_config_apply` mutate configuration while declaring `side_effect_scope: none`,
 *  so the read/write split classified them read-only. */
export const APPROVAL_REQUIRED_TOOLS: ReadonlySet<McpToolName> = new Set(
  TOOL_MANIFEST.filter((entry) => isLiveMcpTool(entry) && entry.requires_human_approval)
    .map((entry) => entry.name as McpToolName),
);
