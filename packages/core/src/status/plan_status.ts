/**
 * @module SharedPlanStatus
 * @path src/shared/status/plan_status.ts
 * @description Shared type definitions and coercion utilities for execution plan statuses.
 * @architectural-layer Shared
 * * @related-files [src/shared/status/request_status.ts]
 */

import { GeneralStatus } from "../enums.ts";
import type { JSONValue } from "../types/json.ts";

export const PlanStatus = {
  REVIEW: "review",
  APPROVED: "approved",
  ACTIVE: "active",
  COMPLETED: GeneralStatus.COMPLETED,
  FAILED: "failed",
  ERROR: "error",
  REJECTED: GeneralStatus.REJECTED,
  NEEDS_REVISION: "needs_revision",
  PENDING: GeneralStatus.PENDING,
  AMENDMENT_PENDING: "amendment_pending",
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
  PlanStatus.AMENDMENT_PENDING,
] as const;

export function isPlanStatus(value: JSONValue): value is PlanStatus {
  return typeof value === "string" && (PLAN_STATUS_VALUES as readonly string[]).includes(value);
}

export function coercePlanStatus(
  value: JSONValue,
  fallback: PlanStatus = PlanStatus.PENDING,
): PlanStatus {
  return isPlanStatus(value) ? value : fallback;
}
