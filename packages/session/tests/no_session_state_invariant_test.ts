/**
 * @module NoSessionStateInvariantTest
 * @path packages/session/tests/no_session_state_invariant_test.ts
 * @description Phase 106 §H invariant — the dedicated negative test that NO
 *   conversation/session/handoff state crosses from a delegated return into any
 *   pipeline artifact produced from it. We feed every gate mapper + the cost
 *   mapper a return deliberately loaded with a transcript reference and a
 *   sensitive resume token, then assert neither value (nor a transcript/
 *   resume_token/conversation field) survives into the produced artifact. Only
 *   the typed decision + human summary are allowed to cross the membrane.
 */

import { assertEquals } from "@std/assert";
import { SessionReturnSchema } from "@exaix/schemas/session_delegate.ts";
import type { SessionReturn } from "@exaix/schemas/session_delegate.ts";
import {
  buildAmendmentDecision,
  buildClarificationFromDelegation,
  buildReviewDecisionPatch,
} from "@exaix/session/gate_mappers.ts";
import { sessionReturnToCostRecord } from "@exaix/session/cost_mapping.ts";

const SECRET_RESUME_TOKEN = "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d.SENSITIVE-HANDOFF-TOKEN";
const TRANSCRIPT_PATH = "Session/trace-01/transcript-FULL-CHAT-LOG.jsonl";
const NOW = "2026-06-12T00:00:00.000Z";

/** A return loaded with handoff/session state that MUST NOT leak into artifacts. */
function loadedReturn(decision: SessionReturn["decision"], summary: string): SessionReturn {
  return SessionReturnSchema.parse({
    trace_id: "00000000-0000-0000-0000-0000000000d6",
    resume_token: SECRET_RESUME_TOKEN,
    decision,
    summary,
    paths_touched: [],
    token_stats: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    transcript_ref: TRANSCRIPT_PATH,
  });
}

/** Assert a serialized pipeline artifact carries no session/handoff/conversation state. */
function assertNoSessionState(artifact: object, label: string): void {
  const serialized = JSON.stringify(artifact);
  assertEquals(serialized.includes(SECRET_RESUME_TOKEN), false, `${label}: resume_token value leaked`);
  assertEquals(serialized.includes(TRANSCRIPT_PATH), false, `${label}: transcript_ref value leaked`);
  assertEquals(/transcript/i.test(serialized), false, `${label}: a transcript field leaked`);
  assertEquals(/resume_token/i.test(serialized), false, `${label}: a resume_token field leaked`);
  assertEquals(/conversation/i.test(serialized), false, `${label}: a conversation field leaked`);
}

Deno.test("[session_invariant][security] a plan-amendment decision carries no session state", () => {
  const decision = buildAmendmentDecision({
    amendmentId: "11111111-2222-3333-4444-555555555555",
    sessionReturn: loadedReturn("approved", "Plan looks correct."),
    decidedBy: "session:claude-code",
    now: NOW,
  });
  assertNoSessionState(decision, "amendment decision");
});

Deno.test("[session_invariant][security] a review decision patch carries no session state", () => {
  const patch = buildReviewDecisionPatch(loadedReturn("rejected", "Fails the quality gate."));
  assertNoSessionState(patch, "review patch");
});

Deno.test("[session_invariant][security] a clarification session carries no session state", () => {
  const session = buildClarificationFromDelegation({
    requestId: "req-01",
    originalBody: "Add a feature.",
    sessionReturn: loadedReturn("enriched", "Clarified acceptance criteria."),
  });
  assertNoSessionState(session, "clarification session");
});

Deno.test("[session_invariant][security] a delegated cost record carries no session state", () => {
  const record = sessionReturnToCostRecord({
    id: "cost-1",
    tool: "claude-code",
    sessionReturn: loadedReturn("changes_made", "Did the work."),
    traceId: "trace-1",
    timestamp: new Date(NOW),
  });
  assertNoSessionState(record, "cost record");
});
