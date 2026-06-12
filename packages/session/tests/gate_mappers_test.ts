/**
 * @module GateMappersTest
 * @path packages/session/tests/gate_mappers_test.ts
 * @description Phase 106 Step 7 — tests for the GAP-8 snake→camel gate mappers.
 *   A delegated plan_review return maps to a schema-valid ZPlanAmendmentDecision
 *   and a delegated review return maps to a Review status patch, so both
 *   round-trip through the existing amendment/review contracts.
 */

import { assertEquals } from "@std/assert";
import { ZPlanAmendmentDecision } from "@exaix/schemas/plan_amendment.ts";
import { ClarificationSessionSchema, ClarificationSessionStatus } from "@exaix/schemas/clarification_session.ts";
import { ReviewStatus } from "@exaix/core/status";
import { SessionReturnSchema } from "@exaix/schemas/session_delegate.ts";
import type { SessionReturn } from "@exaix/schemas/session_delegate.ts";
import {
  buildAmendmentDecision,
  buildClarificationFromDelegation,
  buildReviewDecisionPatch,
  sessionDecisionToAmendmentVerdict,
  sessionDecisionToReviewStatus,
} from "@exaix/session/gate_mappers.ts";

const TRACE = "00000000-0000-0000-0000-000000000a07";
const AMENDMENT_ID = "11111111-2222-3333-4444-555555555555";
const NOW = "2026-06-11T00:00:00.000Z";
const DECIDED_BY = "session:claude-code";

function ret(decision: SessionReturn["decision"], summary = "Reviewed."): SessionReturn {
  return SessionReturnSchema.parse({
    trace_id: TRACE,
    resume_token: "tok",
    decision,
    summary,
    paths_touched: [],
    token_stats: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
  });
}

Deno.test("[gate_mappers] plan_review verdict mapping covers every legal verb", () => {
  assertEquals(sessionDecisionToAmendmentVerdict("approved"), "approved");
  assertEquals(sessionDecisionToAmendmentVerdict("amended"), "approved");
  assertEquals(sessionDecisionToAmendmentVerdict("rejected"), "rejected");
  assertEquals(sessionDecisionToAmendmentVerdict("abandoned"), "expired");
});

Deno.test("[gate_mappers] buildAmendmentDecision round-trips through ZPlanAmendmentDecision", () => {
  const decision = buildAmendmentDecision({
    amendmentId: AMENDMENT_ID,
    sessionReturn: ret("approved", "Plan looks correct."),
    decidedBy: DECIDED_BY,
    now: NOW,
  });
  // Must be valid against the canonical amendment-decision contract.
  const parsed = ZPlanAmendmentDecision.parse(decision);
  assertEquals(parsed.amendmentId, AMENDMENT_ID);
  assertEquals(parsed.decision, "approved");
  assertEquals(parsed.decidedBy, DECIDED_BY);
  assertEquals(parsed.rationale, "Plan looks correct.");
});

Deno.test("[gate_mappers] a rejected plan_review maps to a rejected amendment decision", () => {
  const decision = buildAmendmentDecision({
    amendmentId: AMENDMENT_ID,
    sessionReturn: ret("rejected", "Plan is unsafe."),
    decidedBy: DECIDED_BY,
    now: NOW,
  });
  assertEquals(ZPlanAmendmentDecision.parse(decision).decision, "rejected");
});

Deno.test("[gate_mappers] review status mapping: approved → APPROVED, else REJECTED", () => {
  assertEquals(sessionDecisionToReviewStatus("approved"), ReviewStatus.APPROVED);
  assertEquals(sessionDecisionToReviewStatus("rejected"), ReviewStatus.REJECTED);
  assertEquals(sessionDecisionToReviewStatus("abandoned"), ReviewStatus.REJECTED);
});

Deno.test("[gate_mappers] buildReviewDecisionPatch carries the rejection reason only on reject", () => {
  const approved = buildReviewDecisionPatch(ret("approved", "LGTM"));
  assertEquals(approved.status, ReviewStatus.APPROVED);
  assertEquals(approved.rejection_reason, undefined);

  const rejected = buildReviewDecisionPatch(ret("rejected", "Fails the quality gate"));
  assertEquals(rejected.status, ReviewStatus.REJECTED);
  assertEquals(rejected.rejection_reason, "Fails the quality gate");
});

Deno.test("[gate_mappers] an enriched refinement round-trips through ClarificationSessionSchema", () => {
  const session = buildClarificationFromDelegation({
    requestId: "req-01",
    originalBody: "Add a feature.",
    sessionReturn: ret("enriched", "Clarified acceptance criteria."),
  });
  const parsed = ClarificationSessionSchema.parse(session);
  assertEquals(parsed.requestId, "req-01");
  assertEquals(parsed.originalBody, "Add a feature.");
  assertEquals(parsed.status, ClarificationSessionStatus.USER_CONFIRMED);
  assertEquals(parsed.rounds, []);
});

Deno.test("[gate_mappers] an abandoned refinement marks the clarification user-cancelled", () => {
  const session = buildClarificationFromDelegation({
    requestId: "req-02",
    originalBody: "Add a feature.",
    sessionReturn: ret("abandoned", "Gave up."),
  });
  assertEquals(session.status, ClarificationSessionStatus.USER_CANCELLED);
});
