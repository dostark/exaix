/**
 * @module SkillToolsDerivation
 * @path packages/execution/src/skill_tools_derivation.ts
 * @description Derives the effective tool set for an execution from matched skills' own
 *   `tools` declarations, unioned across every matched skill and then intersected with the
 *   identity blueprint's `permitted_tools` — a skill can only ever narrow within what the
 *   identity already permits, never grant a tool the identity doesn't already allow. Mirrors
 *   the fail-closed precedent in `dynamic_step_executor.ts:resolvePermittedTools` (identity's
 *   permitted_tools is always the ceiling) and the standalone pure-function convention in
 *   `task_type_derivation.ts`.
 * @architectural-layer Execution
 * @related-files [packages/execution/src/agent_orchestrator.ts, packages/execution/src/task_type_derivation.ts, packages/flow/src/dynamic_step_executor.ts]
 */

import type { Opt, Reason } from "@exaix/core/types";

/**
 * Union every matched skill's `tools` (deduplicated), then intersect with the identity's
 * `permitted_tools`. When `permittedTools` is undefined, the identity has no MCP-tool
 * restriction declared at all — every union member passes through unfiltered. When
 * `permittedTools` is an empty array, the identity permits no tools — the result is always
 * empty regardless of what skills declare, matching `resolvePermittedTools`'s fail-closed
 * behaviour for an identity with no tool grants.
 */
export function resolveEffectiveSkillTools(
  matchedSkillTools: Array<string[] | undefined>,
  permittedTools: Opt<string[], Reason.OptionalInput>,
): string[] {
  const union = new Set<string>();
  for (const tools of matchedSkillTools) {
    for (const tool of tools ?? []) {
      union.add(tool);
    }
  }

  if (permittedTools === undefined) {
    return [...union];
  }

  const permitted = new Set(permittedTools);
  return [...union].filter((tool) => permitted.has(tool));
}
