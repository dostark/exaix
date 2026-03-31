/**
 * @module SharedRequestStatus
 * @path src/shared/status/request_status.ts
 * @description Shared type definitions and utility functions for Request lifecycle states.
 * @architectural-layer Shared
 * * @related-files [src/shared/status/plan_status.ts]
 */
export const RequestStatus = {
  PENDING: "pending",
  PLANNED: "planned",
  IN_PROGRESS: "in_progress",
  COMPLETED: "completed",
  FAILED: "failed",
  CANCELLED: "cancelled",
  /** Request is awaiting human answers to clarification questions. */
  NEEDS_CLARIFICATION: "needs_clarification",
  /** Active Q&A loop in progress between planning agent and user. */
  REFINING: "refining",
  /** LLM-based automatic enrichment of the request body is in progress. */
  ENRICHING: "enriching",
  /** Intent analysis is currently in progress. */
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

export function isRequestStatus(value: unknown): value is RequestStatus {
  return typeof value === "string" && (REQUEST_STATUS_VALUES as readonly string[]).includes(value);
}

export function coerceRequestStatus(
  value: unknown,
  fallback: RequestStatus = RequestStatus.PENDING,
): RequestStatus {
  return isRequestStatus(value) ? value : fallback;
}
