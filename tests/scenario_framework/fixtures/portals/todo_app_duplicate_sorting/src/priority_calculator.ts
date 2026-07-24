/**
 * @module TodoAppPriorityCalculator
 * @path src/priority_calculator.ts
 * @description Due-date-aware priority escalation with shared sort logic.
 */

import type { ITask, Priority } from "./models.ts";

export function daysUntilDue(dueDate: string | null): number | null {
  if (!dueDate) return null;
  const due = new Date(dueDate);
  const now = new Date();
  const diff = due.getTime() - now.getTime();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

export function escalatedPriority(task: ITask): Priority {
  const days = daysUntilDue(task.dueDate);
  if (days !== null && days <= 2) {
    return task.priority === "low" ? "medium" : task.priority === "medium" ? "high" : "high";
  }
  return task.priority;
}

function compareByEscalatedPriority(a: ITask, b: ITask): number {
  const pa = escalatedPriority(a);
  const pb = escalatedPriority(b);
  const order = { low: 0, medium: 1, high: 2 };
  const diff = order[pb] - order[pa];
  if (diff !== 0) return diff;
  if (!a.dueDate && !b.dueDate) return 0;
  if (!a.dueDate) return 1;
  if (!b.dueDate) return -1;
  return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
}

export function sortByEscalatedPriority(tasks: ITask[]): ITask[] {
  return [...tasks].sort(compareByEscalatedPriority);
}

export function sortTasksForDisplay(tasks: ITask[]): ITask[] {
  return [...tasks].sort(compareByEscalatedPriority);
}
