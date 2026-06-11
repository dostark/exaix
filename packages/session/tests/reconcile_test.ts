/**
 * @module ReconcileTest
 * @path packages/session/tests/reconcile_test.ts
 * @description Phase 106 Step 4 — tests for reconcile(): GAP-2 token validation,
 *   gate/decision legality, GAP-3 scope enforcement (hard block), and R7
 *   non-blocking budget overage. A forged token, an out-of-gate decision, or any
 *   out-of-scope path must reject; an opaque transcript_ref is never parsed.
 */

import { assertEquals } from "@std/assert";
import { SessionBriefSchema, SessionReturnSchema } from "@exaix/schemas/session_delegate.ts";
import type { SessionBrief, SessionReturn } from "@exaix/schemas/session_delegate.ts";
import { reconcile } from "@exaix/session/reconcile.ts";

const WORKTREE = "/workspace/worktrees/trace-01";
const RESUME = "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d.deadbeefdeadbeef";
const TRACE = "00000000-0000-0000-0000-0000000000ee";
const OTHER_TRACE = "11111111-1111-1111-1111-111111111111";

function brief(overrides: Partial<SessionBrief> = {}): SessionBrief {
  return SessionBriefSchema.parse({
    trace_id: TRACE,
    gate: "code_changes",
    tool: "claude-code",
    objective: "Implement the feature within src/.",
    artifact_ref: "Workspace/Plans/req-01_plan.md",
    permitted_paths: ["src/**"],
    token_budget: { max_input_tokens: 50_000, max_output_tokens: 50_000, max_total_tokens: 100_000 },
    resume_token: RESUME,
    deadline: "2026-07-01T00:00:00.000Z",
    ...overrides,
  });
}

function ret(overrides: Partial<SessionReturn> = {}): SessionReturn {
  return SessionReturnSchema.parse({
    trace_id: TRACE,
    resume_token: RESUME,
    decision: "changes_made",
    summary: "Implemented the feature.",
    paths_touched: ["src/feature.ts"],
    token_stats: { input_tokens: 10_000, output_tokens: 10_000, total_tokens: 20_000 },
    ...overrides,
  });
}

Deno.test("[reconcile] clean in-scope diff with a valid token is accepted", () => {
  const result = reconcile({ brief: brief(), sessionReturn: ret(), worktreeRoot: WORKTREE });
  assertEquals(result.accepted, true);
  assertEquals(result.tokenValid, true);
  assertEquals(result.scopeViolations, []);
  assertEquals(result.decision, "changes_made");
  assertEquals(result.budgetExceeded, false);
  assertEquals(result.rejection, undefined);
});

Deno.test("[reconcile][security] GAP-3 — an out-of-scope path hard-blocks", () => {
  const result = reconcile({
    brief: brief(),
    sessionReturn: ret({ paths_touched: ["src/feature.ts", ".env"] }),
    worktreeRoot: WORKTREE,
  });
  assertEquals(result.accepted, false);
  assertEquals(result.scopeViolations.includes(".env"), true);
  assertEquals(result.rejection, "scope_violation");
});

Deno.test("[reconcile][security] GAP-2 — a forged resume token is rejected", () => {
  const result = reconcile({
    brief: brief(),
    sessionReturn: ret({ resume_token: "FORGED-TOKEN-VALUE" }),
    worktreeRoot: WORKTREE,
  });
  assertEquals(result.tokenValid, false);
  assertEquals(result.accepted, false);
  assertEquals(result.rejection, "forged_token");
});

Deno.test("[reconcile][security] GAP-2 — a mismatched trace_id is rejected", () => {
  const result = reconcile({
    brief: brief(),
    sessionReturn: ret({ trace_id: OTHER_TRACE }),
    worktreeRoot: WORKTREE,
  });
  assertEquals(result.tokenValid, false);
  assertEquals(result.rejection, "forged_token");
});

Deno.test("[reconcile] an out-of-gate decision verb is rejected", () => {
  // 'enriched' is a refinement verb, illegal at the code_changes gate
  const result = reconcile({
    brief: brief(),
    sessionReturn: ret({ decision: "enriched" }),
    worktreeRoot: WORKTREE,
  });
  assertEquals(result.accepted, false);
  assertEquals(result.rejection, "decision_gate_mismatch");
});

Deno.test("[reconcile] R7 — budget overage is flagged but does not block", () => {
  const result = reconcile({
    brief: brief(),
    sessionReturn: ret({
      token_stats: { input_tokens: 90_000, output_tokens: 70_000, total_tokens: 160_000 },
    }),
    worktreeRoot: WORKTREE,
  });
  assertEquals(result.budgetExceeded, true);
  assertEquals(result.accepted, true, "budget overage must not block acceptance");
  assertEquals(result.scopeViolations, []);
});

Deno.test("[reconcile][security] an opaque transcript_ref is never parsed as state", () => {
  const result = reconcile({
    brief: brief(),
    sessionReturn: ret({ transcript_ref: "../../../etc/passwd" }),
    worktreeRoot: WORKTREE,
  });
  // The malicious transcript_ref must not surface as a scope violation or error.
  assertEquals(result.accepted, true);
  assertEquals(result.scopeViolations, []);
});

Deno.test("[reconcile][security] traversal in paths_touched is a scope violation", () => {
  const result = reconcile({
    brief: brief({ permitted_paths: ["src/**", "../**"] }),
    sessionReturn: ret({ paths_touched: ["../escape.ts"] }),
    worktreeRoot: WORKTREE,
  });
  assertEquals(result.accepted, false);
  assertEquals(result.scopeViolations.includes("../escape.ts"), true);
});

Deno.test("[reconcile] an empty diff with a valid token is accepted", () => {
  const result = reconcile({
    brief: brief({ gate: "plan_review", permitted_paths: ["Workspace/Plans/**"] }),
    sessionReturn: ret({ decision: "approved", paths_touched: [] }),
    worktreeRoot: WORKTREE,
  });
  assertEquals(result.accepted, true);
  assertEquals(result.scopeViolations, []);
  assertEquals(result.decision, "approved");
});
