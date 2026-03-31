/**
 * @module ReviewStatus
 * @path src/reviews/review_status.ts
 * @description Type definitions and utility functions for Review outcome states.
 * @architectural-layer Reviews
 * * @related-files [src/services/review_registry.ts, src/shared/schemas/review.ts]
 */
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

export function isReviewStatus(value: unknown): value is IReviewStatus {
  return value === ReviewStatus.PENDING || value === ReviewStatus.APPROVED || value === ReviewStatus.REJECTED;
}

export function coerceReviewStatus(value: unknown, fallback: IReviewStatus = ReviewStatus.PENDING): IReviewStatus {
  return isReviewStatus(value) ? value : fallback;
}
