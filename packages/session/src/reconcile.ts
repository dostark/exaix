/**
 * @module Reconcile
 * @path packages/session/src/reconcile.ts
 * @description Session-delegation reconciliation: validate a parsed return.json
 *   against its brief. Enforces GAP-2 (constant-time token + trace binding),
 *   gate/decision legality, and GAP-3 scope (a non-empty violation list hard-
 *   blocks). Budget overage (Risk R7) is flagged but non-blocking. The opaque
 *   transcript_ref is never read. Package-pure: no Config / DatabaseService.
 * @architectural-layer Services
 * @dependencies [@exaix/schemas]
 * @related-files [packages/session/src/scope_checker.ts, packages/schemas/src/session_delegate.ts]
 */

import { isDecisionValidForGate } from "@exaix/schemas/session_delegate.ts";
import type {
  SessionBrief,
  SessionDecision,
  SessionReconcileRejection,
  SessionReturn,
  SessionTokenStats,
} from "@exaix/schemas/session_delegate.ts";
import { constantTimeEqual } from "./constant_time.ts";
import { checkScope } from "./scope_checker.ts";

/** Inputs to reconcile() — a parsed return plus its originating brief. */
export interface IReconcileInput {
  brief: SessionBrief;
  sessionReturn: SessionReturn;
  /** Absolute worktree root used for stage-1 traversal-safety checks. */
  worktreeRoot: string;
}

/** Outcome of reconciliation; `accepted` gates whether the wait state resumes. */
export interface IReconcileResult {
  /** True only when the token is valid, the decision is gate-legal, and scope holds. */
  accepted: boolean;
  /** Constant-time resume_token + trace_id match against the brief. */
  tokenValid: boolean;
  /** Decision verb reported by the tool (authoritative only when accepted). */
  decision: SessionDecision;
  /** Touched paths outside permitted_paths; non-empty hard-blocks. */
  scopeViolations: string[];
  tokenStats: SessionTokenStats;
  /** token_stats.total_tokens > brief budget (Risk R7); non-blocking. */
  budgetExceeded: boolean;
  /** Typed reason when `accepted` is false; absent when accepted. */
  rejection?: SessionReconcileRejection;
}

/** Evaluation order: token → gate/decision → scope; budget is computed regardless and
 *  never blocks. */
export function reconcile(input: IReconcileInput): IReconcileResult {
  const { brief, sessionReturn, worktreeRoot } = input;
  const tokenStats = sessionReturn.token_stats;
  const budgetExceeded = tokenStats.total_tokens > brief.token_budget.max_total_tokens;

  const base = {
    decision: sessionReturn.decision,
    scopeViolations: [] as string[],
    tokenStats,
    budgetExceeded,
  };

  const tokenValid = constantTimeEqual(sessionReturn.resume_token, brief.resume_token) &&
    sessionReturn.trace_id === brief.trace_id;
  if (!tokenValid) {
    return { ...base, accepted: false, tokenValid: false, rejection: "forged_token" };
  }

  if (!isDecisionValidForGate(brief.gate, sessionReturn.decision)) {
    return { ...base, accepted: false, tokenValid: true, rejection: "decision_gate_mismatch" };
  }

  const scopeViolations = checkScope(sessionReturn.paths_touched, brief.permitted_paths, worktreeRoot).violations;
  if (scopeViolations.length > 0) {
    return { ...base, accepted: false, tokenValid: true, scopeViolations, rejection: "scope_violation" };
  }

  return { ...base, accepted: true, tokenValid: true };
}
