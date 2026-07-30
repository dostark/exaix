/**
 * @module TodoAppUtils
 * @path src/utils.ts
 * @description swe_tasks fixture portal: display formatting helpers for tasks.
 *   formatAssignee and formatDueDate crash on the common case of an unassigned
 *   task / a task with no due date — the swe-fix-bug-null-guard scenario's target.
 */

import type { ITask } from "./models.ts";

export function formatAssignee(task: ITask): string {
  // Bug: crashes when assignee is null — the scenario tests fix this
  return (task.assignee as NonNullable<ITask["assignee"]>).name.toUpperCase();
}

export function formatDueDate(task: ITask): string {
  // Bug: crashes when dueDate is null — the scenario tests fix this
  return (task.dueDate as NonNullable<ITask["dueDate"]>).slice(0, 10);
}

export function formatTaskSummary(task: ITask): string {
  const status = task.done ? "[x]" : "[ ]";
  return `${status} ${task.title} (${task.priority})`;
}
