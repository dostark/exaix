/**
 * @module ClarificationReentryService
 * @path packages/quality-gate/src/clarification_reentry_service.ts
 * @description Provides re-entry and skip-status helpers for the request quality
 * gate lifecycle — determines when to skip quality assessment for already-processed
 * or in-clarification requests, and checks the assessed_at bypass flag.
 * @architectural-layer Domain
 * @ungrounded
 * @related-files [packages/quality-gate/tests/clarification_re_entry_test.ts]
 */
import { RequestStatus } from "@exaix/core/status";

export const CLARIFICATION_SKIP_STATUSES: readonly string[] = [
  RequestStatus.PLANNED,
  RequestStatus.COMPLETED,
  RequestStatus.FAILED,
  RequestStatus.CANCELLED,
  RequestStatus.NEEDS_CLARIFICATION,
  RequestStatus.REFINING,
  RequestStatus.ANALYZING,
];

export function shouldSkipByStatus(status: string): boolean {
  return CLARIFICATION_SKIP_STATUSES.includes(status);
}

export function hasAssessedAt(frontmatter: { assessed_at?: string }): boolean {
  return !!frontmatter.assessed_at;
}
