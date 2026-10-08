/**
 * @module SessionReturnWatchSecurityTest
 * @path tests/integration/session_return_watch_security_test.ts
 * @description Security tests for SessionReturnProcessor: partial return files are not
 *   processed, forged tokens and out-of-scope returns keep the gate pending.
 * @architectural-layer Test
 * @related-files [packages/session/src/session_return_processor.ts]
 */

import { assertEquals } from "@std/assert";
import { briefFor, dropReturn, makeRig, park } from "./helpers/session_return_watch_helpers.ts";

Deno.test("[integration/session_return][security] GAP-10 — a partial return.json is not processed", async () => {
  const rig = await makeRig();
  try {
    const brief = await briefFor(rig, "plan_review", ["Workspace/Plans/**"]);
    await park(rig, brief);
    // Truncated JSON (as if mid-write) — must not advance the gate.
    await dropReturn(rig, brief.trace_id, '{"trace_id":"' + brief.trace_id + '","resume_token":"');

    const outcome = await rig.processor.processReturn(brief.trace_id);
    assertEquals(outcome.processed, false);
    assertEquals((await rig.store.get(brief.trace_id))?.status, "pending");
  } finally {
    await rig.cleanup();
  }
});

Deno.test("[integration/session_return][security] GAP-2 — a forged token does not resume the gate", async () => {
  const rig = await makeRig();
  try {
    const brief = await briefFor(rig, "code_changes", ["src/**"]);
    await park(rig, brief);
    await dropReturn(rig, brief.trace_id, {
      trace_id: brief.trace_id,
      resume_token: "FORGED-TOKEN",
      decision: "changes_made",
      summary: "Sneaky.",
      paths_touched: ["src/x.ts"],
      token_stats: { input_tokens: 10, output_tokens: 10, total_tokens: 20 },
    });

    const outcome = await rig.processor.processReturn(brief.trace_id);
    assertEquals(outcome.processed, true);
    assertEquals(outcome.accepted, false);
    assertEquals(outcome.rejection, "forged_token");
    assertEquals((await rig.store.get(brief.trace_id))?.status, "pending");
  } finally {
    await rig.cleanup();
  }
});

Deno.test("[integration/session_return][security] an out-of-scope return keeps the gate pending", async () => {
  const rig = await makeRig();
  try {
    const brief = await briefFor(rig, "code_changes", ["src/**"]);
    await park(rig, brief);
    await dropReturn(rig, brief.trace_id, {
      trace_id: brief.trace_id,
      resume_token: brief.resume_token,
      decision: "changes_made",
      summary: "Touched a forbidden file.",
      paths_touched: ["src/ok.ts", ".env"],
      token_stats: { input_tokens: 10, output_tokens: 10, total_tokens: 20 },
    });

    const outcome = await rig.processor.processReturn(brief.trace_id);
    assertEquals(outcome.accepted, false);
    assertEquals(outcome.rejection, "scope_violation");
    assertEquals(outcome.scopeViolations.includes(".env"), true);
    assertEquals((await rig.store.get(brief.trace_id))?.status, "pending");
  } finally {
    await rig.cleanup();
  }
});
