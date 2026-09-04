/**
 * @module ScenarioFrameworkAgentRoleTaskTypeReport
 * @path tests/scenario_framework/runner/agent_role_task_type_report.ts
 * @description Phase 158 Step 5's per-task-type delta grouping: an agent role may win on
 * one task type (e.g. bugfix) and lose on another (e.g. refactor), so this groups Step
 * 1's already-computed per-task deltas (`arm_comparison.ts`'s `ITaskPairedResult[]`) by
 * task type rather than collapsing them into one aggregate, which would hide exactly
 * that disagreement. Pure computation only — the caller supplies the paired comparison
 * and the task-id-to-task-type mapping.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/tests/unit/agent_role_task_type_report_test.ts, tests/scenario_framework/runner/arm_comparison.ts]
 */

import type { ITaskPairedResult } from "./arm_comparison.ts";

export interface ITaskTypeGroup {
  taskType: string;
  meanDelta: number;
  stdevDelta: number;
  /** Same no-effect rule as the aggregate comparison: |meanDelta| < stdevDelta. */
  noEffect: boolean;
  taskIds: string[];
}

function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function populationStdev(values: number[], aroundMean: number): number {
  const variance = values.reduce((sum, v) => sum + (v - aroundMean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

/** Throws if a task in `perTask` has no entry in `taskTypeById` — a data-integrity gap, not a row to skip silently. */
export function groupDeltasByTaskType(
  perTask: ITaskPairedResult[],
  taskTypeById: Record<string, string>,
): ITaskTypeGroup[] {
  const taskIdsByType = new Map<string, string[]>();
  const deltasByType = new Map<string, number[]>();

  for (const task of perTask) {
    const taskType = taskTypeById[task.taskId];
    if (taskType === undefined) {
      throw new Error(`Task "${task.taskId}" has no declared task type.`);
    }
    if (!deltasByType.has(taskType)) {
      deltasByType.set(taskType, []);
      taskIdsByType.set(taskType, []);
    }
    deltasByType.get(taskType)!.push(task.delta);
    taskIdsByType.get(taskType)!.push(task.taskId);
  }

  return [...deltasByType.entries()].map(([taskType, deltas]): ITaskTypeGroup => {
    const meanDelta = mean(deltas);
    const stdevDelta = populationStdev(deltas, meanDelta);
    return {
      taskType,
      meanDelta,
      stdevDelta,
      noEffect: Math.abs(meanDelta) < stdevDelta,
      taskIds: taskIdsByType.get(taskType)!,
    };
  });
}
