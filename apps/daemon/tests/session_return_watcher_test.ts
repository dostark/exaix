/**
 * @module SessionReturnWatcherTest
 * @path apps/daemon/tests/session_return_watcher_test.ts
 * @description Phase 106 Step 6 — tests for the daemon SessionReturnWatcher's
 *   per-return handler: it resumes the gate and journals the right
 *   session.delegate.* event on accept, scope violation, and forged token, and
 *   stays silent on a partial/absent return (GAP-10).
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { DomainEventType } from "@exaix/core/events";
import { EventLogger } from "@exaix/core/logger";
import type { ILogEvent } from "@exaix/core/types";
import { initTestDbService } from "@exaix/testing";
import { createDefaultSessionAdapterRegistry } from "@exaix/session/session_adapter_registry.ts";
import { SessionDelegateService } from "@exaix/session/session_delegate_service.ts";
import { SessionWaitStore } from "@exaix/session/wait/session_wait_store.ts";
import { SessionReturnProcessor } from "@exaix/session/session_return_processor.ts";
import { SessionDelegationResultStore } from "@exaix/session/session_delegation_result_store.ts";
import { SessionReturnWatcher } from "../src/session_return_watcher.ts";
import type { SessionBrief } from "@exaix/schemas/session_delegate.ts";

const FIXED_NOW = new Date("2026-06-11T00:00:00.000Z");
const fixedClock = { now: () => FIXED_NOW };

class RecordingSink {
  readonly events: ILogEvent[] = [];
  log(event: ILogEvent): Promise<void> {
    this.events.push(event);
    return Promise.resolve();
  }
  actions(): string[] {
    return this.events.map((e) => e.action);
  }
}

interface IRig {
  sessionDir: string;
  store: SessionWaitStore;
  resultStore: SessionDelegationResultStore;
  sink: RecordingSink;
  watcher: SessionReturnWatcher;
  service: SessionDelegateService;
  cleanup: () => Promise<void>;
}

async function makeRig(): Promise<IRig> {
  const sessionDir = await Deno.makeTempDir();
  const waitDir = await Deno.makeTempDir();
  const store = new SessionWaitStore(waitDir, fixedClock);
  const resultStore = new SessionDelegationResultStore(waitDir);
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
  const sink = new RecordingSink();
  const watcher = new SessionReturnWatcher({ sessionDir, processor, resultStore, logger: sink });
  return {
    sessionDir,
    store,
    resultStore,
    sink,
    watcher,
    service,
    cleanup: async () => {
      await Deno.remove(sessionDir, { recursive: true });
      await Deno.remove(waitDir, { recursive: true });
    },
  };
}

async function setup(rig: IRig, gate: SessionBrief["gate"], permitted: string[]): Promise<SessionBrief> {
  const brief = await rig.service.prepareBrief({
    traceId: crypto.randomUUID(),
    gate,
    tool: "claude-code",
    objective: "Do the work.",
    artifactRef: "Workspace/Plans/p.md",
    permittedPaths: permitted,
    tokenBudget: { max_input_tokens: 50_000, max_output_tokens: 50_000, max_total_tokens: 100_000 },
  });
  await rig.store.park(brief.trace_id, brief.gate, brief.resume_token, brief.deadline);
  return brief;
}

async function dropReturn(rig: IRig, traceId: string, body: string | object): Promise<string> {
  const dir = join(rig.sessionDir, traceId);
  await Deno.mkdir(dir, { recursive: true });
  const target = join(dir, "return.json");
  await Deno.writeTextFile(target, typeof body === "string" ? body : JSON.stringify(body));
  return target;
}

Deno.test("[session_return_watcher] accepted return resumes the gate and journals reconciled", async () => {
  const rig = await makeRig();
  try {
    const brief = await setup(rig, "plan_review", ["Workspace/Plans/**"]);
    const path = await dropReturn(rig, brief.trace_id, {
      trace_id: brief.trace_id,
      resume_token: brief.resume_token,
      decision: "approved",
      summary: "ok",
      paths_touched: [],
      token_stats: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    });
    await rig.watcher.handleReturnPath(path);
    assertEquals(rig.sink.actions().includes(DomainEventType.SessionDelegateReturned), true);
    assertEquals(rig.sink.actions().includes(DomainEventType.SessionDelegateReconciled), true);
    assertEquals((await rig.store.get(brief.trace_id))?.status, "resumed");
  } finally {
    await rig.cleanup();
  }
});

Deno.test("[session_return_watcher][security] forged token journals token_rejected, gate stays pending", async () => {
  const rig = await makeRig();
  try {
    const brief = await setup(rig, "code_changes", ["src/**"]);
    const path = await dropReturn(rig, brief.trace_id, {
      trace_id: brief.trace_id,
      resume_token: "FORGED",
      decision: "changes_made",
      summary: "x",
      paths_touched: ["src/a.ts"],
      token_stats: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    });
    await rig.watcher.handleReturnPath(path);
    assertEquals(rig.sink.actions().includes(DomainEventType.SessionDelegateTokenRejected), true);
    assertEquals((await rig.store.get(brief.trace_id))?.status, "pending");
  } finally {
    await rig.cleanup();
  }
});

Deno.test("[session_return_watcher][security] scope violation journals scope_violation", async () => {
  const rig = await makeRig();
  try {
    const brief = await setup(rig, "code_changes", ["src/**"]);
    const path = await dropReturn(rig, brief.trace_id, {
      trace_id: brief.trace_id,
      resume_token: brief.resume_token,
      decision: "changes_made",
      summary: "x",
      paths_touched: ["src/a.ts", ".env"],
      token_stats: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    });
    await rig.watcher.handleReturnPath(path);
    assertEquals(rig.sink.actions().includes(DomainEventType.SessionDelegateScopeViolation), true);
    assertEquals((await rig.store.get(brief.trace_id))?.status, "pending");
  } finally {
    await rig.cleanup();
  }
});

Deno.test("[session_return_watcher][security] GAP-10 — a partial return journals nothing", async () => {
  const rig = await makeRig();
  try {
    const brief = await setup(rig, "review", ["Workspace/**"]);
    const path = await dropReturn(rig, brief.trace_id, '{"trace_id":"' + brief.trace_id + '"');
    await rig.watcher.handleReturnPath(path);
    assertEquals(rig.sink.events.length, 0);
    assertEquals((await rig.store.get(brief.trace_id))?.status, "pending");
  } finally {
    await rig.cleanup();
  }
});

Deno.test("[session_return_watcher] onReconciled callback invoked on accept, not on rejection", async () => {
  const rig = await makeRig();
  try {
    const reconciledCalls: string[] = [];
    const watcher = new SessionReturnWatcher({
      sessionDir: rig.sessionDir,
      processor: new SessionReturnProcessor({
        sessionDir: rig.sessionDir,
        workspaceRoot: rig.sessionDir,
        waitStore: rig.store,
        resultStore: rig.resultStore,
      }),
      resultStore: rig.resultStore,
      logger: rig.sink,
      onReconciled: (outcome) => {
        reconciledCalls.push(`${outcome.delegationTraceId}:${outcome.decision}`);
      },
    });

    // Accepted return triggers onReconciled
    const brief1 = await setup(rig, "plan_review", ["Workspace/Plans/**"]);
    const path1 = await dropReturn(rig, brief1.trace_id, {
      trace_id: brief1.trace_id,
      resume_token: brief1.resume_token,
      decision: "approved",
      summary: "ok",
      paths_touched: [],
      token_stats: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    });
    await watcher.handleReturnPath(path1);
    assertEquals(reconciledCalls.length, 1, "onReconciled must fire on accept");
    assertEquals(reconciledCalls[0].startsWith(brief1.trace_id), true);

    // Forged-token rejection does NOT trigger onReconciled
    const brief2 = await setup(rig, "code_changes", ["src/**"]);
    const path2 = await dropReturn(rig, brief2.trace_id, {
      trace_id: brief2.trace_id,
      resume_token: "FORGED",
      decision: "changes_made",
      summary: "x",
      paths_touched: ["src/a.ts"],
      token_stats: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    });
    await watcher.handleReturnPath(path2);
    assertEquals(reconciledCalls.length, 1, "onReconciled must NOT fire on rejection");
  } finally {
    await rig.cleanup();
  }
});

Deno.test("[session_return_watcher][race] duplicate notifications resume and dispatch exactly once", async () => {
  const rig = await makeRig();
  try {
    let callbackCount = 0;
    const watcher = new SessionReturnWatcher({
      sessionDir: rig.sessionDir,
      processor: new SessionReturnProcessor({
        sessionDir: rig.sessionDir,
        workspaceRoot: rig.sessionDir,
        waitStore: rig.store,
        resultStore: rig.resultStore,
      }),
      resultStore: rig.resultStore,
      logger: rig.sink,
      onReconciled: () => {
        callbackCount += 1;
      },
    });
    const brief = await setup(rig, "code_changes", ["src/**"]);
    const path = await dropReturn(rig, brief.trace_id, {
      trace_id: brief.trace_id,
      resume_token: brief.resume_token,
      decision: "changes_made",
      summary: "exactly once",
      paths_touched: ["src/a.ts"],
      token_stats: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    });

    await Promise.all([
      watcher.handleReturnPath(path),
      watcher.handleReturnPath(path),
      watcher.handleReturnPath(path),
    ]);

    assertEquals(callbackCount, 1);
    assertEquals((await rig.store.get(brief.trace_id))?.status, "resumed");
    assertEquals((await rig.resultStore.get(brief.trace_id))?.summary, "exactly once");
  } finally {
    await rig.cleanup();
  }
});

Deno.test("[session_return_watcher][Tier A] reconciled event persists delegation and parent lineage", async () => {
  const rig = await makeRig();
  const { db, cleanup } = await initTestDbService();
  try {
    const parentTraceId = crypto.randomUUID();
    const brief = await rig.service.prepareBrief({
      traceId: crypto.randomUUID(),
      parentTraceId,
      parentStepId: "7",
      sequence: 7,
      gate: "code_changes",
      tool: "codex",
      objective: "Persist lineage.",
      artifactRef: ".exa/PlanContext/phase-174.md",
      permittedPaths: ["src/**"],
      tokenBudget: { max_input_tokens: 10, max_output_tokens: 10, max_total_tokens: 20 },
    });
    await rig.store.park(brief.trace_id, brief.gate, brief.resume_token, brief.deadline);
    const path = await dropReturn(rig, brief.trace_id, {
      trace_id: brief.trace_id,
      resume_token: brief.resume_token,
      decision: "changes_made",
      summary: "lineage persisted",
      paths_touched: ["src/a.ts"],
      token_stats: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    });
    const watcher = new SessionReturnWatcher({
      sessionDir: rig.sessionDir,
      processor: new SessionReturnProcessor({
        sessionDir: rig.sessionDir,
        workspaceRoot: rig.sessionDir,
        waitStore: rig.store,
        resultStore: rig.resultStore,
      }),
      resultStore: rig.resultStore,
      logger: new EventLogger({ db }),
    });

    await watcher.handleReturnPath(path);
    await db.waitForFlush();

    const event = (await db.getActivitiesByTraceSafe(brief.trace_id)).find(
      (item) => item.action_type === DomainEventType.SessionDelegateReconciled,
    );
    assertEquals(event !== undefined, true);
    assertEquals(event?.payload.includes(parentTraceId), true);
    assertEquals(event?.payload.includes('"parent_step_id":"7"'), true);
  } finally {
    await cleanup();
    await rig.cleanup();
  }
});

Deno.test("[session_return_watcher] an over-budget accepted return also journals budget_exceeded (P2)", async () => {
  const rig = await makeRig();
  try {
    const brief = await setup(rig, "plan_review", ["Workspace/Plans/**"]);
    // total_tokens 150_000 exceeds the brief's 100_000 max — accepted but over budget.
    const path = await dropReturn(rig, brief.trace_id, {
      trace_id: brief.trace_id,
      resume_token: brief.resume_token,
      decision: "approved",
      summary: "ok but pricey",
      paths_touched: [],
      token_stats: { input_tokens: 120_000, output_tokens: 30_000, total_tokens: 150_000 },
    });
    await rig.watcher.handleReturnPath(path);
    assertEquals(rig.sink.actions().includes(DomainEventType.SessionDelegateReconciled), true);
    assertEquals(rig.sink.actions().includes(DomainEventType.SessionDelegateBudgetExceeded), true);
    // Budget overage is non-blocking: the gate still resumes.
    assertEquals((await rig.store.get(brief.trace_id))?.status, "resumed");
  } finally {
    await rig.cleanup();
  }
});

Deno.test("[session_return_watcher][security] journaled events carry traceId as the actual ILogEvent field, not just target — required for trace_scoped journal-assert to find them", async () => {
  // GAP found live proving Phase 167 Step 4's mandated trace-scoped session.delegate.*
  // assertions: journal() set `target` to the traceId but never the ILogEvent `traceId`
  // field itself, so EventLogger.log() fell back to a fresh crypto.randomUUID() for the
  // persisted row's trace_id column — the exact column a `trace_scoped: true`
  // journal-assert filters on (`WHERE trace_id = ?`). A row whose target LOOKS like the
  // right trace but whose trace_id column is a random UUID is invisible to that filter.
  const rig = await makeRig();
  try {
    const brief = await setup(rig, "plan_review", ["Workspace/Plans/**"]);
    const path = await dropReturn(rig, brief.trace_id, {
      trace_id: brief.trace_id,
      resume_token: brief.resume_token,
      decision: "approved",
      summary: "ok",
      paths_touched: [],
      token_stats: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    });
    await rig.watcher.handleReturnPath(path);

    const returned = rig.sink.events.find((e) => e.action === DomainEventType.SessionDelegateReturned);
    const reconciled = rig.sink.events.find((e) => e.action === DomainEventType.SessionDelegateReconciled);
    assertEquals(returned?.traceId, brief.trace_id);
    assertEquals(reconciled?.traceId, brief.trace_id);
    // Regression: target keeps carrying the traceId too (existing convention elsewhere,
    // e.g. recovery.ts's SessionDelegateCrashRecovered) — this fix is additive, not a swap.
    assertEquals(returned?.target, brief.trace_id);
    assertEquals(reconciled?.target, brief.trace_id);
  } finally {
    await rig.cleanup();
  }
});
