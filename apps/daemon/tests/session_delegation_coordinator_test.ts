/**
 * @module SessionDelegationCoordinatorTest
 * @path apps/daemon/tests/session_delegation_coordinator_test.ts
 * @description Phase 174 Step 1 unit and Tier-A tests for terminal mapping,
 *   lineage, authority isolation, and visible coordinator lifecycle events.
 * @architectural-layer Tests
 * @related-files [apps/daemon/src/session_delegation_coordinator.ts, packages/session/src/session_delegation.ts]
 */

import { assertEquals, assertNotEquals } from "@std/assert";
import { DomainEventType } from "@exaix/core/events";
import { EventLogger } from "@exaix/core/logger";
import type { IEventLogger } from "@exaix/core/logger";
import { initTestDbService } from "@exaix/testing";
import { SessionBriefSchema } from "@exaix/schemas/session_delegate.ts";
import type { SessionBrief, SessionDelegateConfig, SessionWaitState } from "@exaix/schemas/session_delegate.ts";
import type { ISessionLaunch } from "@exaix/session/i_session_adapter.ts";
import type {
  IHardenedLaunchResult,
  IPrepareBriefInput,
  ISessionDelegateService,
} from "@exaix/session/i_session_delegate.ts";
import type { ISessionWaitStore } from "@exaix/session/wait/i_session_wait_store.ts";
import {
  type ISessionDelegationOutcome,
  type ISessionDelegationRequest,
  SessionDelegationOutcomeSchema,
} from "@exaix/session/session_delegation.ts";
import type {
  ISessionDelegationResultRecord,
  ISessionDelegationResultStore,
} from "@exaix/session/session_delegation_result_store.ts";
import {
  type ISessionDelegationCoordinatorDeps,
  SessionDelegationCoordinator,
} from "../src/session_delegation_coordinator.ts";

const PARENT_TRACE_ID = "00000000-0000-4000-8000-000000000173";
const FIXED_NOW = new Date("2026-08-28T12:00:00.000Z");
const CONFIG: SessionDelegateConfig = {
  enabled: true,
  tool: "codex",
  model: "openai:gpt-5",
  gates: ["code_changes"],
  launch_mode: "headless",
  permitted_paths: ["packages/**"],
  token_budget: {
    max_input_tokens: 1_000,
    max_output_tokens: 500,
    max_total_tokens: 1_500,
  },
  harden_permissions: false,
};

class RecordingDelegateService implements ISessionDelegateService {
  readonly prepared: IPrepareBriefInput[] = [];
  failPrepare = false;

  prepareBrief(input: IPrepareBriefInput): Promise<SessionBrief> {
    this.prepared.push(input);
    if (this.failPrepare) return Promise.reject(new Error("prepare failed"));
    return Promise.resolve(SessionBriefSchema.parse({
      trace_id: input.traceId,
      parent_trace_id: input.parentTraceId,
      parent_step_id: input.parentStepId,
      sequence: input.sequence,
      gate: input.gate,
      tool: input.tool,
      objective: input.objective,
      model: input.model,
      artifact_ref: input.artifactRef,
      acceptance_criteria: input.acceptanceCriteria,
      permitted_paths: input.permittedPaths,
      worktree_path: input.worktreePath,
      token_budget: input.tokenBudget,
      resume_token: "resume-token",
      deadline: input.deadline,
    }));
  }

  resolveLaunch(brief: SessionBrief): ISessionLaunch {
    return { command: "codex", args: [], cwd: brief.worktree_path ?? "/tmp", env: {} };
  }

  resolveHardenedLaunch(brief: SessionBrief): Promise<IHardenedLaunchResult> {
    return Promise.resolve({ launch: this.resolveLaunch(brief), agentNameMismatch: false });
  }

  resolveDelegateEnv(): Record<string, string> {
    return {};
  }
}

class RecordingWaitStore implements ISessionWaitStore {
  status: SessionWaitState["status"] = "resumed";
  decision: SessionWaitState["decision"] = "changes_made";

  park(traceId: string, gate: SessionBrief["gate"], resumeToken: string, deadline: string): Promise<SessionWaitState> {
    return Promise.resolve({
      trace_id: traceId,
      gate,
      resume_token: resumeToken,
      deadline,
      status: "pending",
      created_at: FIXED_NOW.toISOString(),
    });
  }

  resume(): Promise<SessionWaitState> {
    return Promise.reject(new Error("not used"));
  }

  expire(traceId: string): Promise<SessionWaitState> {
    this.status = "expired";
    return this.get(traceId).then((state) => state!);
  }

  cancel(traceId: string): Promise<SessionWaitState> {
    this.status = "cancelled";
    return this.get(traceId).then((state) => state!);
  }

  get(traceId: string): Promise<SessionWaitState | undefined> {
    return Promise.resolve({
      trace_id: traceId,
      gate: "code_changes",
      resume_token: "resume-token",
      deadline: "2026-12-31T00:00:00.000Z",
      status: this.status,
      decision: this.decision,
      created_at: FIXED_NOW.toISOString(),
    });
  }
}

class OutcomeResultStore implements ISessionDelegationResultStore {
  status: ISessionDelegationOutcome["status"] | null = "completed";
  request: ISessionDelegationRequest | null = null;

  publishAccepted(): Promise<void> {
    return Promise.resolve();
  }

  publishRejected(): Promise<void> {
    return Promise.resolve();
  }

  get(traceId: string): Promise<ISessionDelegationOutcome | null> {
    if (!this.status || !this.request) return Promise.resolve(null);
    return Promise.resolve(SessionDelegationOutcomeSchema.parse({
      delegationTraceId: traceId,
      parentTraceId: this.request.parentTraceId,
      parentStepId: this.request.parentStepId,
      sequence: this.request.sequence,
      status: this.status,
      decision: this.status === "abandoned" ? "abandoned" : this.status === "completed" ? "changes_made" : undefined,
      summary: `${this.status} outcome`,
      pathsTouched: this.status === "completed" ? ["packages/session/mod.ts"] : [],
      tokenStats: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
      rejection: this.status === "rejected" ? "scope_violation" : undefined,
    }));
  }

  getRecord(): Promise<ISessionDelegationResultRecord | null> {
    return Promise.resolve(null);
  }

  markDelivered(): Promise<boolean> {
    return Promise.resolve(true);
  }
}

class RecordingLauncher {
  calls = 0;
  launch(): Promise<void> {
    this.calls += 1;
    return Promise.resolve();
  }
}

function request(): ISessionDelegationRequest {
  return {
    parentTraceId: PARENT_TRACE_ID,
    parentStepId: "1",
    sequence: 1,
    objective: "Implement the coordinator.",
    acceptanceCriteria: ["The coordinator is wired."],
    artifactRef: ".exa/PlanContext/phase-174.md",
    worktreePath: "/tmp/worktree",
  };
}

function makeDeps(
  delegateService: RecordingDelegateService,
  waitStore: RecordingWaitStore,
  resultStore: OutcomeResultStore,
  launcher: RecordingLauncher,
): ISessionDelegationCoordinatorDeps {
  return {
    config: CONFIG,
    delegateService,
    waitStore,
    resultStore,
    launcher,
    resolveProviderApiKey: () => undefined,
    resolveModel: () => Promise.resolve(undefined),
    now: () => FIXED_NOW,
    sleep: () => Promise.resolve(),
  };
}

Deno.test("[session_delegation_coordinator] maps every terminal path to its exact status", async () => {
  const delegateService = new RecordingDelegateService();
  const waitStore = new RecordingWaitStore();
  const resultStore = new OutcomeResultStore();
  const launcher = new RecordingLauncher();
  const logger = new EventLogger({ outputs: [] });
  const coordinator = new SessionDelegationCoordinator(
    makeDeps(delegateService, waitStore, resultStore, launcher),
    logger,
  );

  for (const status of ["completed", "abandoned", "rejected"] as const) {
    resultStore.status = status;
    resultStore.request = request();
    assertEquals((await coordinator.delegate(request())).status, status);
  }

  resultStore.status = null;
  waitStore.status = "expired";
  assertEquals((await coordinator.delegate(request())).status, "expired");
  waitStore.status = "cancelled";
  assertEquals((await coordinator.delegate(request())).status, "cancelled");

  delegateService.failPrepare = true;
  assertEquals((await coordinator.delegate(request())).status, "launch_failed");
});

Deno.test("[session_delegation_coordinator][security] caller authority fields are ignored and lineage traces are unique", async () => {
  const delegateService = new RecordingDelegateService();
  const waitStore = new RecordingWaitStore();
  const resultStore = new OutcomeResultStore();
  const launcher = new RecordingLauncher();
  const logger: IEventLogger = new EventLogger({ outputs: [] });
  const coordinator = new SessionDelegationCoordinator(
    makeDeps(delegateService, waitStore, resultStore, launcher),
    logger,
  );
  const untrusted = {
    ...request(),
    tool: "cursor",
    permittedPaths: [".env"],
    tokenBudget: { max_input_tokens: 9, max_output_tokens: 9, max_total_tokens: 9 },
    providerApiKey: "must-not-cross",
  };
  resultStore.request = untrusted;

  const first = await coordinator.delegate(untrusted);
  const second = await coordinator.delegate(untrusted);

  assertNotEquals(first.delegationTraceId, second.delegationTraceId);
  assertEquals(first.parentTraceId, PARENT_TRACE_ID);
  assertEquals(delegateService.prepared[0].parentTraceId, PARENT_TRACE_ID);
  assertEquals(delegateService.prepared[0].tool, CONFIG.tool);
  assertEquals(delegateService.prepared[0].permittedPaths, CONFIG.permitted_paths);
  assertEquals(delegateService.prepared[0].tokenBudget, CONFIG.token_budget);
});

Deno.test("[session_delegation_coordinator][Tier A] launched event is trace-linked and redacted", async () => {
  const { db, cleanup } = await initTestDbService();
  try {
    const logger = new EventLogger({ db });
    const delegateService = new RecordingDelegateService();
    const waitStore = new RecordingWaitStore();
    const resultStore = new OutcomeResultStore();
    const launcher = new RecordingLauncher();
    resultStore.request = request();
    const coordinator = new SessionDelegationCoordinator(
      makeDeps(delegateService, waitStore, resultStore, launcher),
      logger,
    );

    const outcome = await coordinator.delegate(request());
    await db.waitForFlush();
    const events = await db.getActivitiesByTraceSafe(outcome.delegationTraceId);
    const launched = events.find((event) => event.action_type === DomainEventType.SessionDelegateLaunched);
    const payload = JSON.parse(launched?.payload ?? "{}");

    assertEquals(launched?.trace_id, outcome.delegationTraceId);
    assertEquals(payload.parent_trace_id, PARENT_TRACE_ID);
    assertEquals(payload.parent_step_id, "1");
    assertEquals(payload.sequence, 1);
    assertEquals(payload.brief, undefined);
    assertEquals(payload.objective, undefined);
    assertEquals(payload.resume_token, undefined);
    assertEquals(JSON.stringify(payload).includes("/tmp/worktree"), false);
  } finally {
    await cleanup();
  }
});
