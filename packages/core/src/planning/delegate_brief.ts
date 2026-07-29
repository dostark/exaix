/**
 * @module DelegateBrief
 * @path packages/core/src/planning/delegate_brief.ts
 * @description Pure helper to build delegate brief args (objective + acceptanceCriteria) from
 *   step data for the code-changes delegation callback (Phase 150 Step 1).
 * @architectural-layer Core
 * @related-files ["packages/core/src/planning/plan_executor.ts", "apps/daemon/main.ts"]
 */
export interface IDelegateBriefArgs {
  objective: string;
  acceptanceCriteria?: string[];
}

export function buildDelegateBriefArgs(
  step: { title: string; content: string; successCriteria?: string[] },
): IDelegateBriefArgs {
  return {
    objective: step.content,
    acceptanceCriteria: step.successCriteria?.length ? [...step.successCriteria] : undefined,
  };
}

/**
 * Checks whether a brief objective is contentless (empty) or matches the legacy
 * placeholder shape ("Execute step N"). Returns true when the guard should reject
 * the brief (Phase 150 Step 2).
 */
export function isContentlessBrief(objective: string): boolean {
  if (!objective || objective.trim().length === 0) return true;
  const placeholderPattern = /^[Ee]xecute\s+step\s+\d+/;
  return placeholderPattern.test(objective.trim());
}
