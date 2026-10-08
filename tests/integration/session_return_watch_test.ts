/**
 * @module SessionReturnWatchTest
 * @path tests/integration/session_return_watch_test.ts
 * @description Phase 106 Step 6 — integration tests for SessionReturnProcessor:
 *   the package-pure core the daemon's SessionReturnWatcher invokes when a
 *   return.json appears. Exercises the full park → brief → return → reconcile →
 *   resume lifecycle, plus GAP-10 partial-file and GAP-2 forged-token guards.
 */

import { assertEquals } from "@std/assert";
import { briefFor, dropReturn, makeRig, park } from "./helpers/session_return_watch_helpers.ts";

Deno.test("[integration/session_return] valid return resumes the parked gate", async () => {
  const rig = await makeRig();
  try {
    const brief = await briefFor(rig, "plan_review", ["Workspace/Plans/**"]);
    await park(rig, brief);
    await dropReturn(rig, brief.trace_id, {
      trace_id: brief.trace_id,
      resume_token: brief.resume_token,
      decision: "approved",
      summary: "Approved.",
      paths_touched: [],
      token_stats: { input_tokens: 1_000, output_tokens: 500, total_tokens: 1_500 },
    });

    const outcome = await rig.processor.processReturn(brief.trace_id);
    assertEquals(outcome.processed, true);
    assertEquals(outcome.accepted, true);
    assertEquals(outcome.decision, "approved");
    assertEquals((await rig.store.get(brief.trace_id))?.status, "resumed");
  } finally {
    await rig.cleanup();
  }
});

Deno.test("[integration/session_return] processing the same return.json twice is an idempotent no-op (no throw)", async () => {
  // Regression: Deno.watchFs fires multiple write events for one return.json, so processReturn
  // runs twice for the same trace. The second call must NOT throw `wait state is resumed, not
  // pending` (which used to crash the daemon) — it's a benign no-op.
  const rig = await makeRig();
  try {
    const brief = await briefFor(rig, "code_changes", ["Workspace/**"]);
    await park(rig, brief);
    await dropReturn(rig, brief.trace_id, {
      trace_id: brief.trace_id,
      resume_token: brief.resume_token,
      decision: "changes_made",
      summary: "Done.",
      paths_touched: [],
      token_stats: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
    });

    const first = await rig.processor.processReturn(brief.trace_id);
    assertEquals(first.processed, true);
    assertEquals(first.accepted, true);

    // Second processing of the SAME return must not throw and must not re-resume.
    const second = await rig.processor.processReturn(brief.trace_id);
    assertEquals(second.processed, false); // already-resolved → benign no-op, nothing to re-journal
    assertEquals((await rig.store.get(brief.trace_id))?.status, "resumed");
  } finally {
    await rig.cleanup();
  }
});

Deno.test("[integration/session_return] missing return.json is not processed", async () => {
  const rig = await makeRig();
  try {
    const brief = await briefFor(rig, "review", ["Workspace/**"]);
    await park(rig, brief);
    const outcome = await rig.processor.processReturn(brief.trace_id);
    assertEquals(outcome.processed, false);
    assertEquals((await rig.store.get(brief.trace_id))?.status, "pending");
  } finally {
    await rig.cleanup();
  }
});
