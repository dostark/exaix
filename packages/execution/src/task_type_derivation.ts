/**
 * @module TaskTypeDerivation
 * @path packages/execution/src/task_type_derivation.ts
 * @description Phase 135 Step 8 (§5.8.8) — derives a TaskType for the Team `best`
 *   scorer's benchmark_map lookup. Precedence: request frontmatter > agent role blueprint
 *   declaration > highest-confidence skill trigger > static task_type_map soft-match
 *   (exact, then normalised-prefix; canonical values only, G7) > analyzer-derived intent
 *   > UNKNOWN. An entity's own declaration (frontmatter/agent_role) is never shadowed by
 *   the static map (anti-drift). Edition-agnostic: the derived task-type rides the
 *   intent/trace in Solo without affecting selection — only the Team `best` scorer reads it.
 *   The skill-trigger tier (`topSkillTaskTypes`) is populated by
 *   `PlanExecutor.deriveTopSkillTaskTypes`, which re-runs the application context's
 *   `SkillsService.matchSkills` against the plan's originating request subject — closing
 *   the Reachability Ledger row from the phase-135 planning doc.
 * @architectural-layer Execution
 * @dependencies [@exaix/core/types]
 * @related-files [packages/execution/src/agent_orchestrator.ts, packages/ai/src/model_resolver.ts]
 */
import { TaskType } from "@exaix/core/types";
import type { Opt, Reason } from "@exaix/core/types";
import type { TaskTypeSource } from "@exaix/schemas";

/** Inputs already gathered by the caller (agent_executor) — pure precedence logic here. */
export interface ITaskTypeDerivationContext {
  /** Explicit task_type on the request frontmatter, if any. */
  frontmatterTaskType?: TaskType;
  /** Explicit task_type declared on the agent role blueprint, if any. */
  agentRoleTaskType?: TaskType;
  /** The highest-confidence matched skill's triggers.task_types, in priority order. */
  topSkillTaskTypes?: TaskType[];
  /** The agent_role used for the static task_type_map soft-match. */
  agentRole?: string;
  /** Config's model_registry.task_type_map (entity name → TaskType). */
  taskTypeMap?: Record<string, TaskType>;
  /** RequestAnalysis-derived task type, if the analyzer ran. */
  analyzerTaskType?: TaskType;
}

export interface ITaskTypeDerivationResult {
  taskType: TaskType;
  source: TaskTypeSource;
}

/** Derive a TaskType by walking the precedence chain: frontmatter → agent_role → skill →
 *  static map → analyzer → unknown. */
export function deriveTaskType(ctx: ITaskTypeDerivationContext): ITaskTypeDerivationResult {
  if (ctx.frontmatterTaskType) {
    return { taskType: ctx.frontmatterTaskType, source: "frontmatter" };
  }
  if (ctx.agentRoleTaskType) {
    return { taskType: ctx.agentRoleTaskType, source: "agent_role" };
  }
  if (ctx.topSkillTaskTypes?.length) {
    return { taskType: ctx.topSkillTaskTypes[0], source: "skill" };
  }
  const staticMatch = softMatchTaskTypeMap(ctx.agentRole, ctx.taskTypeMap);
  if (staticMatch) {
    return { taskType: staticMatch, source: "static_map" };
  }
  if (ctx.analyzerTaskType) {
    return { taskType: ctx.analyzerTaskType, source: "analyzer" };
  }
  return { taskType: TaskType.UNKNOWN, source: "unknown" };
}

/** Exact match first, then the longest normalised (hyphen-insensitive) prefix, so
 *  "senior-coder-v2"/"v3" both fall through to a "senior-coder" entry. */
function softMatchTaskTypeMap(
  agentRole: Opt<string, Reason.OptionalInput>,
  taskTypeMap: Opt<Record<string, TaskType>, Reason.OptionalInput>,
): TaskType | undefined {
  if (!agentRole || !taskTypeMap) return undefined;
  if (taskTypeMap[agentRole]) return taskTypeMap[agentRole];

  let bestKey: string | undefined;
  for (const key of Object.keys(taskTypeMap)) {
    if (!agentRole.startsWith(`${key}-`)) continue;
    if (!bestKey || key.length > bestKey.length) bestKey = key;
  }
  return bestKey ? taskTypeMap[bestKey] : undefined;
}
