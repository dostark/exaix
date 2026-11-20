/**
 * @module CompatTypes
 * @path tests/compat/harness/compat_types.ts
 * @description Shared identifiers of the pending-review compatibility harness.
 */

export const COMPAT_SCHEMA_VERSION = "1";

/** One identifier per pending-review case that the harness records and compares. */
export const CompatCaseId = {
  SHOW_CODE: "show-code",
  SHOW_ARTIFACT: "show-artifact",
  APPROVE_ARTIFACT: "approve-artifact",
  REJECT_ARTIFACT: "reject-artifact",
  APPROVE_WORKTREE: "approve-worktree",
  APPROVE_BRANCH_PORTAL: "approve-branch-portal",
  APPROVE_WRONG_BASE: "approve-wrong-base",
  REJECT_WORKTREE: "reject-worktree",
  REJECT_MISSING_REASON: "reject-missing-reason",
  MERGE_CONFLICT: "merge-conflict",
  RESTART_RETRY: "restart-retry",
  OWNER_SCRIPT: "owner-script",
} as const;
export type CompatCaseId = typeof CompatCaseId[keyof typeof CompatCaseId];
