/**
 * @module RequestStatus
 * @path src/shared/status/request_status.ts
 * @description Shared type definitions and coercion utilities for request lifecycle states.
 * @architectural-layer Shared
 * @related-files [src/shared/status/mod.ts, src/shared/status/plan_status.ts]
 */

import { GeneralStatus } from "../enums.ts";
import type { JSONValue } from "../types/json.ts";

export const RequestStatus = {
  PENDING: GeneralStatus.PENDING,
  PLANNED: "planned",
  IN_PROGRESS: "in_progress",
  COMPLETED: GeneralStatus.COMPLETED,
  FAILED: "failed",
  CANCELLED: "cancelled",
  NEEDS_CLARIFICATION: "needs_clarification",
  REFINING: "refining",
  ENRICHING: "enriching",
  ANALYZING: "analyzing",
} as const;

export type RequestStatus = typeof RequestStatus[keyof typeof RequestStatus];
export type RequestStatusType = RequestStatus;

export const REQUEST_STATUS_VALUES = [
  RequestStatus.PENDING,
  RequestStatus.PLANNED,
  RequestStatus.IN_PROGRESS,
  RequestStatus.COMPLETED,
  RequestStatus.FAILED,
  RequestStatus.CANCELLED,
  RequestStatus.NEEDS_CLARIFICATION,
  RequestStatus.REFINING,
  RequestStatus.ENRICHING,
  RequestStatus.ANALYZING,
] as const;

export function isRequestStatus(value: JSONValue): value is RequestStatus {
  return typeof value === "string" && (REQUEST_STATUS_VALUES as readonly string[]).includes(value);
}

export function coerceRequestStatus(
  value: JSONValue,
  fallback: RequestStatus = RequestStatus.PENDING,
): RequestStatus {
  return isRequestStatus(value) ? value : fallback;
}
