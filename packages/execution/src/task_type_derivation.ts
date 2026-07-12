/**
 * @module TaskTypeDerivation
 * @path packages/execution/src/task_type_derivation.ts
 * @description Phase 135 Step 8 (§5.8.8) — derives a TaskType for the Team `best`
 *   scorer's benchmark_map lookup. Precedence: request frontmatter > identity blueprint
 *   declaration > highest-confidence skill trigger > static task_type_map soft-match
 *   (exact, then normalised-prefix; canonical values only, G7) > analyzer-derived intent
 *   > UNKNOWN. An entity's own declaration (frontmatter/identity) is never shadowed by
 *   the static map (anti-drift). Edition-agnostic: the derived task-type rides the
 *   intent/trace in Solo without affecting selection — only the Team `best` scorer reads it.
 *   Phase 135 Step 9 (GAP-C9): the skill-trigger tier (`topSkillTaskTypes`) is currently
 *   UNREACHABLE from PlanExecutor's call path — skill matching only happens in the
 *   unrelated `AgentRunner` one-shot dispatch class, which is a disjoint top-level path
 *   from `PlanExecutor`/`ExecutionLoop` (no shared context, no caller/callee relation).
 *   Wiring it requires a design decision (a new cross-cutting skill-matching step in
 *   plan-execution), not a small wire-up — explicitly descoped from Step 9; see the
 *   Reachability Ledger in the phase-135 planning doc.
 * @architectural-layer Execution
 * @dependencies [@exaix/core/types]
 * @related-files [packages/execution/src/agent_executor.ts, packages/ai/src/model_resolver.ts]
 */
import { TaskType } from "@exaix/core/types";
import type { Opt, Reason } from "@exaix/core/types";
import type { TaskTypeSource } from "@exaix/schemas";

/** Inputs already gathered by the caller (agent_executor) — pure precedence logic here. */
export interface ITaskTypeDerivationContext {
  /** Explicit task_type on the request frontmatter, if any. */
  frontmatterTaskType?: TaskType;
  /** Explicit task_type declared on the identity blueprint, if any. */
  identityTaskType?: TaskType;
  /** The highest-confidence matched skill's triggers.task_types, in priority order. */
  topSkillTaskTypes?: TaskType[];
  /** The identity_id used for the static task_type_map soft-match. */
  identityId?: string;
  /** Config's model_registry.task_type_map (entity name → TaskType). */
  taskTypeMap?: Record<string, TaskType>;
  /** RequestAnalysis-derived task type, if the analyzer ran. */
  analyzerTaskType?: TaskType;
}

export interface ITaskTypeDerivationResult {
  taskType: TaskType;
  source: TaskTypeSource;
}

/** Derive a TaskType by walking the §5.8.8 precedence chain. */
export function deriveTaskType(ctx: ITaskTypeDerivationContext): ITaskTypeDerivationResult {
  if (ctx.frontmatterTaskType) {
    return { taskType: ctx.frontmatterTaskType, source: "frontmatter" };
  }
  if (ctx.identityTaskType) {
    return { taskType: ctx.identityTaskType, source: "identity" };
  }
  if (ctx.topSkillTaskTypes?.length) {
    return { taskType: ctx.topSkillTaskTypes[0], source: "skill" };
  }
  const staticMatch = softMatchTaskTypeMap(ctx.identityId, ctx.taskTypeMap);
  if (staticMatch) {
    return { taskType: staticMatch, source: "static_map" };
  }
  if (ctx.analyzerTaskType) {
    return { taskType: ctx.analyzerTaskType, source: "analyzer" };
  }
  return { taskType: TaskType.UNKNOWN, source: "unknown" };
}

/**
 * Soft-match `identityId` against `taskTypeMap` keys: exact match first, then the
 * longest key that is a normalised (hyphen-insensitive) prefix of identityId — so
 * "senior-coder-v2" and "senior-coder-v3" both fall through to a "senior-coder" entry.
 */
function softMatchTaskTypeMap(
  identityId: Opt<string, Reason.OptionalInput>,
  taskTypeMap: Opt<Record<string, TaskType>, Reason.OptionalInput>,
): TaskType | undefined {
  if (!identityId || !taskTypeMap) return undefined;
  if (taskTypeMap[identityId]) return taskTypeMap[identityId];

  let bestKey: string | undefined;
  for (const key of Object.keys(taskTypeMap)) {
    if (!identityId.startsWith(`${key}-`)) continue;
    if (!bestKey || key.length > bestKey.length) bestKey = key;
  }
  return bestKey ? taskTypeMap[bestKey] : undefined;
}
