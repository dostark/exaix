/**
 * @module SharedPlanStatus
 * @path src/shared/status/plan_status.ts
 * @description Shared type definitions and coercion utilities for execution plan statuses.
 * @architectural-layer Shared
 * * @related-files [src/shared/status/request_status.ts]
 */
export const PlanStatus = {
  REVIEW: "review",
  APPROVED: "approved",
  ACTIVE: "active",
  COMPLETED: "completed",
  FAILED: "failed",
  ERROR: "error",
  REJECTED: "rejected",
  NEEDS_REVISION: "needs_revision",
  PENDING: "pending",
} as const;

export type PlanStatus = typeof PlanStatus[keyof typeof PlanStatus];
export type PlanStatusType = PlanStatus;

export const PLAN_STATUS_VALUES = [
  PlanStatus.REVIEW,
  PlanStatus.APPROVED,
  PlanStatus.ACTIVE,
  PlanStatus.COMPLETED,
  PlanStatus.FAILED,
  PlanStatus.ERROR,
  PlanStatus.REJECTED,
  PlanStatus.NEEDS_REVISION,
  PlanStatus.PENDING,
] as const;

export function isPlanStatus(value: unknown): value is PlanStatus {
  return typeof value === "string" && (PLAN_STATUS_VALUES as readonly string[]).includes(value);
}

export function coercePlanStatus(
  value: unknown,
  fallback: PlanStatus = PlanStatus.PENDING,
): PlanStatus {
  return isPlanStatus(value) ? value : fallback;
}
