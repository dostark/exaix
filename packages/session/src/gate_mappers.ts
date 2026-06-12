/**
 * @module GateMappers
 * @path packages/session/src/gate_mappers.ts
 * @description Phase 106 Step 7 — GAP-8 explicit snake_case→camelCase mappers from
 *   a delegated return into the existing gate contracts. plan_review maps to a
 *   ZPlanAmendmentDecision; review maps to a Review status patch. No implicit
 *   field passthrough — delegation flows through the same amendment/review
 *   contracts as the autonomous/human path (never a governance bypass).
 * @architectural-layer Services
 * @dependencies [@exaix/schemas, @exaix/core]
 * @related-files [packages/schemas/src/plan_amendment.ts, packages/schemas/src/review.ts]
 */

import { ZPlanAmendmentDecision } from "@exaix/schemas/plan_amendment.ts";
import type { IPlanAmendmentDecision } from "@exaix/schemas/plan_amendment.ts";
import { ClarificationSessionSchema, ClarificationSessionStatus } from "@exaix/schemas/clarification_session.ts";
import type { IClarificationSession } from "@exaix/schemas/clarification_session.ts";
import { ReviewStatus } from "@exaix/core/status";
import type { IReviewStatus } from "@exaix/core/status";
import type { SessionDecision, SessionReturn } from "@exaix/schemas/session_delegate.ts";

/** A minimal Review patch a delegated review decision produces. */
export interface IReviewDecisionPatch {
  status: IReviewStatus;
  rejection_reason?: string;
}

/** Inputs for building a delegated plan-amendment decision. */
export interface IAmendmentDecisionInput {
  amendmentId: string;
  sessionReturn: SessionReturn;
  /** Attribution for the decision, e.g. "session:claude-code". */
  decidedBy: string;
  /** ISO timestamp of the decision. */
  now: string;
}

/** Inputs for recording a delegated refinement as a clarification session. */
export interface IRefinementClarificationInput {
  requestId: string;
  /** The original, unmodified request body. */
  originalBody: string;
  sessionReturn: SessionReturn;
}

/** Map a delegated plan_review verb to an amendment-decision verdict. */
export function sessionDecisionToAmendmentVerdict(
  decision: SessionDecision,
): IPlanAmendmentDecision["decision"] {
  switch (decision) {
    case "approved":
    case "amended": // the delegate edited the plan in-place; the edit is accepted
      return "approved";
    case "abandoned": // human gave up → the amendment window expires
      return "expired";
    default: // rejected (and any non-plan_review verb) → safe reject
      return "rejected";
  }
}

/** Build a schema-valid ZPlanAmendmentDecision from a delegated plan_review return. */
export function buildAmendmentDecision(input: IAmendmentDecisionInput): IPlanAmendmentDecision {
  return ZPlanAmendmentDecision.parse({
    amendmentId: input.amendmentId,
    decision: sessionDecisionToAmendmentVerdict(input.sessionReturn.decision),
    decidedAt: input.now,
    decidedBy: input.decidedBy,
    rationale: input.sessionReturn.summary,
  });
}

/** Map a delegated review verb to a Review status (only `approved` approves). */
export function sessionDecisionToReviewStatus(decision: SessionDecision): IReviewStatus {
  return decision === "approved" ? ReviewStatus.APPROVED : ReviewStatus.REJECTED;
}

/** Build a Review status patch; the rejection reason is carried only on reject. */
export function buildReviewDecisionPatch(sessionReturn: SessionReturn): IReviewDecisionPatch {
  const status = sessionDecisionToReviewStatus(sessionReturn.decision);
  return status === ReviewStatus.REJECTED ? { status, rejection_reason: sessionReturn.summary } : { status };
}

/**
 * Record a delegated refinement as a schema-valid ClarificationSession (GAP-8).
 * A delegated enrichment is free-text, not an agent Q&A loop, so no synthetic
 * rounds are fabricated: an `enriched` return marks the session user-confirmed,
 * anything else (e.g. `abandoned`) marks it user-cancelled. The enrichment text
 * itself rides on the journaled return summary.
 */
export function buildClarificationFromDelegation(input: IRefinementClarificationInput): IClarificationSession {
  const status = input.sessionReturn.decision === "enriched"
    ? ClarificationSessionStatus.USER_CONFIRMED
    : ClarificationSessionStatus.USER_CANCELLED;
  return ClarificationSessionSchema.parse({
    requestId: input.requestId,
    originalBody: input.originalBody,
    rounds: [],
    status,
    qualityHistory: [],
  });
}
