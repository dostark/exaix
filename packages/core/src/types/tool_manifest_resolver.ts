/**
 * @module IToolManifestResolver
 * @path packages/core/src/types/tool_manifest_resolver.ts
 * @description Minimal interface for resolving tool manifest metadata at runtime.
 * Implemented by LocalToolDispatcher (Phase 79). Kept separate from IMcpClient so the
 * executor can accept both in a single intersection type.
 * @architectural-layer Shared
 * @dependencies ["packages/core/src/types/enums.ts"]
 * @related-files [packages/mcp/server/local_tool_dispatcher.ts, packages/flow/src/dynamic_step_executor.ts]
 */

import type { McpToolName } from "./enums.ts";

export interface IToolManifestResolver {
  requiresHumanApproval(tool: McpToolName): boolean;
  /** Returns the tool's `preferred_tool_choice_hint` from TOOL_MANIFEST, or undefined
   *  when the tool has no hint set (Phase 154 Step 5). */
  getToolChoiceHint(tool: McpToolName): string | undefined;
}
