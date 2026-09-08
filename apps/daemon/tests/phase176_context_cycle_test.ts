/**
 * @module Phase176ContextCycleTest
 * @path apps/daemon/tests/phase176_context_cycle_test.ts
 * @description Phase 176 Step 1: SessionDelegationCoordinator's dogfood context wiring.
 * Absent contextPort (every non-dogfood/disabled-config caller) sends the existing
 * objective byte-for-byte; an injected contextPort's returned prompt is what actually
 * reaches prepareBrief; acceptanceCriteria/artifactRef are never altered; a prepare()
 * failure surfaces as the existing launch_failed terminal outcome (no new halt path).
 * @architectural-layer Tests
 * @related-files [apps/daemon/src/session_delegation_coordinator.ts]
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { EventLogger } from "@exaix/core/logger";
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
import type { IDogfoodContextHandle, IDogfoodContextInput, IDogfoodContextPort } from "@exaix/core/types";
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
  token_budget: { max_input_tokens: 1_000, max_output_tokens: 500, max_total_tokens: 1_500 },
  harden_permissions: false,
};

class RecordingDelegateService implements ISessionDelegateService {
  readonly prepared: IPrepareBriefInput[] = [];

  prepareBrief(input: IPrepareBriefInput): Promise<SessionBrief> {
    this.prepared.push(input);
    return Promise.resolve(SessionBriefSchema.parse({
      trace_id: input.traceId,
      parent_trace_id: input.parentTraceId,
      parent_step_id: input.parentStepId,
      sequence: input.sequence,
      agent_role: input.agentRole,
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
    agentRole: "test-role",
    objective: "Implement the coordinator.",
    acceptanceCriteria: ["The coordinator is wired."],
    artifactRef: ".exa/PlanContext/phase-174.md",
    worktreePath: "/tmp/worktree",
  };
}

function makeContextPort(prompt: string): { port: IDogfoodContextPort; inputs: IDogfoodContextInput[] } {
  const inputs: IDogfoodContextInput[] = [];
  const port: IDogfoodContextPort = {
    prepare(input: IDogfoodContextInput): Promise<IDogfoodContextHandle> {
      inputs.push(input);
      return Promise.resolve({ recordId: crypto.randomUUID(), prompt });
    },
    close(): Promise<void> {
      return Promise.resolve();
    },
  };
  return { port, inputs };
}

function makeFailingContextPort(): IDogfoodContextPort {
  return {
    prepare(): Promise<IDogfoodContextHandle> {
      return Promise.reject(new Error("context assembly failed"));
    },
    close(): Promise<void> {
      return Promise.resolve();
    },
  };
}

function makeDeps(
  delegateService: RecordingDelegateService,
  waitStore: RecordingWaitStore,
  resultStore: OutcomeResultStore,
  launcher: RecordingLauncher,
  contextPort?: IDogfoodContextPort,
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
    contextPort,
  };
}

Deno.test("[session_delegation_coordinator] absent contextPort sends the existing objective byte-for-byte (non-dogfood parity)", async () => {
  const delegateService = new RecordingDelegateService();
  const waitStore = new RecordingWaitStore();
  const resultStore = new OutcomeResultStore();
  const launcher = new RecordingLauncher();
  const logger = new EventLogger({ outputs: [] });
  const coordinator = new SessionDelegationCoordinator(
    makeDeps(delegateService, waitStore, resultStore, launcher),
    logger,
  );

  resultStore.status = "completed";
  resultStore.request = request();
  await coordinator.delegate(request());

  assertEquals(delegateService.prepared[0].objective, "Implement the coordinator.");
});

Deno.test("[session_delegation_coordinator] an injected contextPort's returned prompt reaches prepareBrief as the objective", async () => {
  const delegateService = new RecordingDelegateService();
  const waitStore = new RecordingWaitStore();
  const resultStore = new OutcomeResultStore();
  const launcher = new RecordingLauncher();
  const logger = new EventLogger({ outputs: [] });
  const { port, inputs } = makeContextPort("AUGMENTED CYCLE OBJECTIVE");
  const coordinator = new SessionDelegationCoordinator(
    makeDeps(delegateService, waitStore, resultStore, launcher, port),
    logger,
  );

  resultStore.status = "completed";
  resultStore.request = request();
  await coordinator.delegate(request());

  assertEquals(delegateService.prepared[0].objective, "AUGMENTED CYCLE OBJECTIVE");
  assertEquals(inputs.length, 1);
  assertEquals(inputs[0].surface, "session_delegate_cycle");
  assertEquals(inputs[0].parentTraceId, PARENT_TRACE_ID);
  assertEquals(inputs[0].stepId, "1");
  assertStringIncludes(inputs[0].originalPrompt, "Implement the coordinator.");
});

Deno.test("[session_delegation_coordinator] acceptanceCriteria and artifactRef are never altered by the contextPort", async () => {
  const delegateService = new RecordingDelegateService();
  const waitStore = new RecordingWaitStore();
  const resultStore = new OutcomeResultStore();
  const launcher = new RecordingLauncher();
  const logger = new EventLogger({ outputs: [] });
  const { port } = makeContextPort("AUGMENTED CYCLE OBJECTIVE");
  const coordinator = new SessionDelegationCoordinator(
    makeDeps(delegateService, waitStore, resultStore, launcher, port),
    logger,
  );

  resultStore.status = "completed";
  resultStore.request = request();
  await coordinator.delegate(request());

  assertEquals(delegateService.prepared[0].acceptanceCriteria, ["The coordinator is wired."]);
  assertEquals(delegateService.prepared[0].artifactRef, ".exa/PlanContext/phase-174.md");
});

Deno.test("[session_delegation_coordinator] a prepare() failure surfaces as the existing launch_failed terminal outcome", async () => {
  const delegateService = new RecordingDelegateService();
  const waitStore = new RecordingWaitStore();
  const resultStore = new OutcomeResultStore();
  const launcher = new RecordingLauncher();
  const logger = new EventLogger({ outputs: [] });
  const coordinator = new SessionDelegationCoordinator(
    makeDeps(delegateService, waitStore, resultStore, launcher, makeFailingContextPort()),
    logger,
  );

  const outcome = await coordinator.delegate(request());

  assertEquals(outcome.status, "launch_failed");
  assertEquals(launcher.calls, 0, "the launcher must never run when context assembly fails");
  assertEquals(delegateService.prepared.length, 0, "prepareBrief on the delegate service is never reached");
});
