/**
 * @module TodoAppPriorityCalculator
 * @path src/priority_calculator.ts
 * @description swe_tasks fixture portal: due-date-aware priority escalation.
 *   Zero test coverage — the swe-write-tests-uncovered scenario's target.
 */

import type { ITask, TaskPriority } from "./models.ts";

const PRIORITY_RANK: Record<TaskPriority, number> = { low: 0, medium: 1, high: 2 };
const ESCALATION_THRESHOLD_MS = 2 * 24 * 60 * 60 * 1000; // 2 days

export function daysUntilDue(task: ITask, now: Date = new Date()): number | null {
  if (!task.dueDate) return null;
  const due = new Date(task.dueDate);
  if (Number.isNaN(due.getTime())) return null;
  return Math.ceil((due.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
}

export function escalatedPriority(task: ITask, now: Date = new Date()): TaskPriority {
  if (task.done || !task.dueDate) return task.priority;
  const due = new Date(task.dueDate);
  if (Number.isNaN(due.getTime())) return task.priority;

  const msUntilDue = due.getTime() - now.getTime();
  if (msUntilDue < 0) return "high";
  if (msUntilDue <= ESCALATION_THRESHOLD_MS && PRIORITY_RANK[task.priority] < PRIORITY_RANK.high) {
    const nextRank = Math.min(PRIORITY_RANK[task.priority] + 1, PRIORITY_RANK.high);
    return (Object.keys(PRIORITY_RANK) as TaskPriority[]).find((p) => PRIORITY_RANK[p] === nextRank)!;
  }
  return task.priority;
}

export function sortByEscalatedPriority(tasks: ITask[], now: Date = new Date()): ITask[] {
  return [...tasks].sort((a, b) => {
    const rankDiff = PRIORITY_RANK[escalatedPriority(b, now)] - PRIORITY_RANK[escalatedPriority(a, now)];
    if (rankDiff !== 0) return rankDiff;
    const aDays = daysUntilDue(a, now) ?? Number.POSITIVE_INFINITY;
    const bDays = daysUntilDue(b, now) ?? Number.POSITIVE_INFINITY;
    return aDays - bDays;
  });
}
