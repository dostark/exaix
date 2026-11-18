/**
 * @module ReviewTypes
 * @path apps/exactl/src/commands/review_types.ts
 * @description The review metadata, detail and lint-summary contracts that the review commands and builders share.
 * @architectural-layer CLI
 * @dependencies [@exaix/core, @exaix/core/events, @exaix/schemas]
 * @related-files [apps/exactl/src/commands/review_commands.ts, apps/exactl/src/commands/review_decisions.ts, apps/exactl/src/commands/review_verification.ts]
 */

import type { ReviewType } from "@exaix/core";
import type { IReviewStatus } from "@exaix/core/status";
import type { IAnomalyFinding, IAnomalySummary } from "@exaix/core/events";
import type { LintCheckRunOutcome, LintErrorClass, VerificationStatus } from "@exaix/schemas";

export interface IReviewMetadata {
  type?: ReviewType;
  file_path?: string;
  branch: string;
  trace_id: string;
  request_id: string;
  base_branch?: string;
  worktree_path?: string;
  files_changed: number;
  created_at: string;
  agent_role: string;
  // Request context
  request_subject?: string;
  request_agent_role?: string;
  request_portal?: string;
  request_priority?: string;
  request_created_by?: string;
  request_flow?: string;
  request_rejected_path?: string;
  // Plan context
  plan_id?: string;
  plan_status?: string;
  // Portal context
  portal?: string;
  // Status context
  status?: IReviewStatus;
  approved_at?: string;
  approved_by?: string;
  // Anomaly context
  anomalySummary?: IAnomalySummary;
  rejected_at?: string;
  rejected_by?: string;
  rejection_reason?: string;
  subject?: string;
}

export interface IReviewDetails extends IReviewMetadata {
  diff: string;
  commits: Array<{
    sha: string;
    message: string;
    timestamp: string;
  }>;
  anomalies?: IAnomalyFinding[];
  /** Post-execution verification outcome from the trace's execution.completed row. */
  verification_status?: VerificationStatus;
  /** Validated terminal lint findings summary of the review run. */
  lint?: IReviewLintSummary;
}

/** One configured lint check outcome in the review. */
interface IReviewLintCheck {
  check_index: number;
  outcome: `${LintCheckRunOutcome}`;
  total: number | null;
  error_class: LintErrorClass | null;
}

/** The validated terminal lint summary of one review run. */
export interface IReviewLintSummary {
  total: number | null;
  findings: Array<{ file: string; line: number; rule: string }>;
  truncated: boolean;
  checks: IReviewLintCheck[];
  /** True when the completed run has no loadable final snapshot. */
  unavailable?: boolean;
}
