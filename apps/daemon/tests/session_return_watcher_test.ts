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
import type { ILogEvent } from "@exaix/core/types";
import { createDefaultSessionAdapterRegistry } from "@exaix/session/session_adapter_registry.ts";
import { SessionDelegateService } from "@exaix/session/session_delegate_service.ts";
import { SessionWaitStore } from "@exaix/session/wait/session_wait_store.ts";
import { SessionReturnProcessor } from "@exaix/session/session_return_processor.ts";
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
  sink: RecordingSink;
  watcher: SessionReturnWatcher;
  service: SessionDelegateService;
  cleanup: () => Promise<void>;
}

async function makeRig(): Promise<IRig> {
  const sessionDir = await Deno.makeTempDir();
  const waitDir = await Deno.makeTempDir();
  const store = new SessionWaitStore(waitDir, fixedClock);
  const service = new SessionDelegateService({
    registry: createDefaultSessionAdapterRegistry(),
    clock: fixedClock,
    sessionDir,
  });
  const processor = new SessionReturnProcessor({ sessionDir, workspaceRoot: sessionDir, waitStore: store });
  const sink = new RecordingSink();
  const watcher = new SessionReturnWatcher({ sessionDir, processor, logger: sink });
  return {
    sessionDir,
    store,
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
      }),
      logger: rig.sink,
      onReconciled: (traceId: string, decision: string) => {
        reconciledCalls.push(`${traceId}:${decision}`);
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
