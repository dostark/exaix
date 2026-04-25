/**
 * @module ReviewStatus
 * @path src/reviews/review_status.ts
 * @description Type definitions and utility functions for Review outcome states.
 * @architectural-layer Reviews
 * * @related-files [src/services/review_registry.ts, src/shared/schemas/review.ts]
 */

import type { JSONValue } from "@exaix/core";

export const ReviewStatus = {
  PENDING: "pending",
  APPROVED: "approved",
  REJECTED: "rejected",
} as const;

export type IReviewStatus = (typeof ReviewStatus)[keyof typeof ReviewStatus];

export const REVIEW_STATUS_VALUES = [
  ReviewStatus.PENDING,
  ReviewStatus.APPROVED,
  ReviewStatus.REJECTED,
] as const;

type ReviewStatusCandidate = JSONValue;

export function isReviewStatus(value: ReviewStatusCandidate): value is IReviewStatus {
  return value === ReviewStatus.PENDING || value === ReviewStatus.APPROVED || value === ReviewStatus.REJECTED;
}

export function coerceReviewStatus(
  value: ReviewStatusCandidate,
  fallback: IReviewStatus = ReviewStatus.PENDING,
): IReviewStatus {
  return isReviewStatus(value) ? value : fallback;
}
