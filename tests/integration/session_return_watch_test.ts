/**
 * @module SessionReturnWatchTest
 * @path tests/integration/session_return_watch_test.ts
 * @description Phase 106 Step 6 — integration tests for SessionReturnProcessor:
 *   the package-pure core the daemon's SessionReturnWatcher invokes when a
 *   return.json appears. Exercises the full park → brief → return → reconcile →
 *   resume lifecycle, plus GAP-10 partial-file and GAP-2 forged-token guards.
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { createDefaultSessionAdapterRegistry } from "@exaix/session/session_adapter_registry.ts";
import { SessionDelegateService } from "@exaix/session/session_delegate_service.ts";
import { SessionWaitStore } from "@exaix/session/wait/session_wait_store.ts";
import { SessionReturnProcessor } from "@exaix/session/session_return_processor.ts";
import { SessionDelegationResultStore } from "@exaix/session/session_delegation_result_store.ts";
import type { SessionBrief } from "@exaix/schemas/session_delegate.ts";

const FIXED_NOW = new Date("2026-06-11T00:00:00.000Z");
const fixedClock = { now: () => FIXED_NOW };

interface ITestRig {
  sessionDir: string;
  waitDir: string;
  store: SessionWaitStore;
  processor: SessionReturnProcessor;
  service: SessionDelegateService;
  cleanup: () => Promise<void>;
}

async function makeRig(): Promise<ITestRig> {
  const sessionDir = await Deno.makeTempDir();
  const waitDir = await Deno.makeTempDir();
  const store = new SessionWaitStore(waitDir, fixedClock);
  const resultStore = new SessionDelegationResultStore(waitDir, fixedClock.now);
  const service = new SessionDelegateService({
    registry: createDefaultSessionAdapterRegistry(),
    clock: fixedClock,
    sessionDir,
  });
  const processor = new SessionReturnProcessor({
    sessionDir,
    workspaceRoot: sessionDir,
    waitStore: store,
    resultStore,
  });
  return {
    sessionDir,
    waitDir,
    store,
    processor,
    service,
    cleanup: async () => {
      await Deno.remove(sessionDir, { recursive: true });
      await Deno.remove(waitDir, { recursive: true });
    },
  };
}

async function park(rig: ITestRig, brief: SessionBrief): Promise<void> {
  await rig.store.park(brief.trace_id, brief.gate, brief.resume_token, brief.deadline);
}

async function dropReturn(rig: ITestRig, traceId: string, body: string | object): Promise<void> {
  const dir = join(rig.sessionDir, traceId);
  await Deno.mkdir(dir, { recursive: true });
  const target = join(dir, "return.json");
  const tmp = `${target}.tmp`;
  await Deno.writeTextFile(tmp, typeof body === "string" ? body : JSON.stringify(body, null, 2));
  await Deno.rename(tmp, target);
}

async function briefFor(rig: ITestRig, gate: SessionBrief["gate"], permitted: string[]): Promise<SessionBrief> {
  return await rig.service.prepareBrief({
    traceId: crypto.randomUUID(),
    gate,
    tool: "claude-code",
    objective: "Do the work.",
    artifactRef: "Workspace/Plans/req_plan.md",
    permittedPaths: permitted,
    tokenBudget: { max_input_tokens: 50_000, max_output_tokens: 50_000, max_total_tokens: 100_000 },
  });
}

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
  // Regression: Deno.watchFs fires multiple write events for one return.json, so the
  // SessionReturnWatcher calls processReturn more than once for the same trace. The first call
  // resumes the wait state; the second must NOT throw `wait state is resumed, not pending` (which
  // crashed the daemon before the reconciled event persisted). The second call is a benign no-op.
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
