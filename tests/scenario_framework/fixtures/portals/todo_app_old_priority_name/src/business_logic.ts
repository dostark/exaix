/**
 * @module TodoAppBusinessLogic
 * @path src/business_logic.ts
 * @description swe_tasks fixture portal: task-submission business rules.
 *   processTaskSubmission is deliberately monolithic — it validates, assigns a
 *   priority, and computes a schedule slot in one function — the
 *   swe-refactor-extract-function scenario's target.
 */

import type { ITask, IUser, TaskPriority } from "./models.ts";

export interface ITaskSubmissionResult {
  success: boolean;
  task?: ITask;
  errors: string[];
}

export function processTaskSubmission(
  title: string,
  rawPriority: string,
  dueDate: string | null,
  assignee: IUser | null,
  existingTasks: ITask[],
): ITaskSubmissionResult {
  const errors: string[] = [];

  if (!title || title.trim().length === 0) errors.push("Title is required");
  if (title.length > 200) errors.push("Title exceeds 200 characters");

  const validPriorities: TaskPriority[] = ["low", "medium", "high"];
  let priority: TaskPriority = "medium";
  if (rawPriority) {
    if (!validPriorities.includes(rawPriority as TaskPriority)) {
      errors.push(`Invalid priority: ${rawPriority}`);
    } else {
      priority = rawPriority as TaskPriority;
    }
  }

  if (dueDate !== null) {
    const parsed = new Date(dueDate);
    if (Number.isNaN(parsed.getTime())) {
      errors.push(`Invalid due date: ${dueDate}`);
    } else if (parsed.getTime() < Date.now()) {
      errors.push("Due date must be in the future");
    }
  }

  const duplicateCount = existingTasks.filter((t) => t.title === title).length;
  if (duplicateCount >= 3) {
    errors.push("Too many tasks with this title already exist");
  }

  if (errors.length > 0) {
    return { success: false, errors };
  }

  const task: ITask = {
    id: crypto.randomUUID(),
    title,
    priority,
    done: false,
    dueDate,
    assignee,
  };

  return { success: true, task, errors: [] };
}
