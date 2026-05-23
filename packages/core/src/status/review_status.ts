/**
 * @module ReviewStatus
 * @path packages/core/src/status/review_status.ts
 * @description Type definitions and utility functions for Review outcome states.
 * @architectural-layer Shared
 * @related-files ["packages/core/src/artifact/review_registry.ts", "packages/schemas/src/review.ts"]
 */

import { GeneralStatus } from "@exaix/core";
import type { JSONValue } from "@exaix/core";

export const ReviewStatus = {
  PENDING: GeneralStatus.PENDING,
  APPROVED: GeneralStatus.APPROVED,
  REJECTED: GeneralStatus.REJECTED,
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
