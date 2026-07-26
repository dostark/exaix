/**
 * @module TodoAppUtils
 * @path src/utils.ts
 * @description swe_tasks fixture portal: display formatting helpers for tasks. Null-safe —
 *   the deliberately-unguarded variant lives only as a _variants/null_guard_bug overlay
 *   used exclusively by the swe-fix-bug-null-guard scenario(s), so scenarios that share
 *   this fixture (add-feature, refactor, write-tests) aren't blocked by an unrelated bug when
 *   `deno test src/` type-checks the whole directory.
 */

import type { ITask } from "./models.ts";

export function formatAssignee(task: ITask): string {
  return task.assignee ? task.assignee.name.toUpperCase() : "";
}

export function formatDueDate(task: ITask): string {
  return task.dueDate ? task.dueDate.slice(0, 10) : "";
}

export function formatTaskSummary(task: ITask): string {
  const status = task.done ? "[x]" : "[ ]";
  return `${status} ${task.title} (${task.priority})`;
}
