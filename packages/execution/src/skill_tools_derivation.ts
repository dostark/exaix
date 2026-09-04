/**
 * @module SkillToolsDerivation
 * @path packages/execution/src/skill_tools_derivation.ts
 * @description Derives the effective tool set for an execution from matched skills' own
 *   `tools` declarations, unioned across every matched skill and then intersected with the
 *   agent role blueprint's `permitted_tools` — a skill can only ever narrow within what the
 *   agent role already permits, never grant a tool the agent role doesn't already allow. Mirrors
 *   the fail-closed precedent in `dynamic_step_executor.ts:resolvePermittedTools` (agent role's
 *   permitted_tools is always the ceiling) and the standalone pure-function convention in
 *   `task_type_derivation.ts`.
 * @architectural-layer Execution
 * @related-files [packages/execution/src/agent_orchestrator.ts, packages/execution/src/task_type_derivation.ts, packages/flow/src/dynamic_step_executor.ts]
 */

import type { Opt, Reason } from "@exaix/core/types";

/** `permittedTools` undefined → no restriction, everything passes; `[]` → no tools permitted,
 *  result is always empty (fail-closed, matching `resolvePermittedTools`). */
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
