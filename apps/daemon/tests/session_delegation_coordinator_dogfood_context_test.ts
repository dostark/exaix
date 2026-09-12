/**
 * @module SessionDelegationCoordinatorDogfoodContextTest
 * @path apps/daemon/tests/session_delegation_coordinator_dogfood_context_test.ts
 * @description SessionDelegationCoordinator's dogfood context wiring.
 * Absent contextPort (every non-dogfood/disabled-config caller) sends the existing
 * objective byte-for-byte; an injected contextPort's returned prompt is what actually
 * reaches prepareBrief; acceptanceCriteria/artifactRef are never altered; a prepare()
 * failure surfaces as the existing launch_failed terminal outcome (no new halt path).
 * Step 2 extends this: the connection reaches resolveHardenedLaunch and the launcher's
 * env, and close() is called with a reason matching the delegation's real outcome.
 * @architectural-layer Tests
 * @related-files [apps/daemon/src/session_delegation_coordinator.ts]
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { EventLogger } from "@exaix/core/logger";
import type { IFlowWorktreeCoordinator } from "@exaix/core/types";
import { SessionBriefSchema } from "@exaix/schemas/session_delegate.ts";
import type {
  SessionBrief,
  SessionDelegateConfig,
  SessionLaunchMode,
  SessionWaitState,
} from "@exaix/schemas/session_delegate.ts";
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
import type {
  IDogfoodContextConnection,
  IDogfoodContextHandle,
  IDogfoodContextInput,
  IDogfoodContextPort,
} from "@exaix/core/types";
import type { IDogfoodMcpConnectionInput } from "@exaix/session/dogfood_mcp_config.ts";
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
  readonly hardenedConnections: Array<IDogfoodMcpConnectionInput | undefined> = [];

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

  resolveHardenedLaunch(
    brief: SessionBrief,
    _mode: SessionLaunchMode,
    _config: SessionDelegateConfig,
    connection?: IDogfoodMcpConnectionInput,
  ): Promise<IHardenedLaunchResult> {
    this.hardenedConnections.push(connection);
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
  envs: Array<Record<string, string> | undefined> = [];
  launch(_launch: ISessionLaunch, _traceId: string, env?: Record<string, string>): Promise<void> {
    this.calls += 1;
    this.envs.push(env);
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

const TEST_CONNECTION: IDogfoodContextConnection = {
  connectionId: "conn-1",
  endpoint: "http://127.0.0.1:9/mcp",
  bearerEnvVar: "EXAIX_CONTEXT_BEARER",
  bearerToken: "test-bearer-value",
  expiresAt: "2026-12-31T00:00:00.000Z",
  tools: [
    { name: "query_relationships", description: "d", inputSchema: {}, outputSchema: {}, schemaDigest: "x" },
    { name: "who_depends_on", description: "d", inputSchema: {}, outputSchema: {}, schemaDigest: "y" },
    { name: "search_memory", description: "d", inputSchema: {}, outputSchema: {}, schemaDigest: "z" },
  ],
};

function makeContextPort(
  prompt: string,
  connection?: IDogfoodContextConnection,
): { port: IDogfoodContextPort; inputs: IDogfoodContextInput[]; closes: Array<{ recordId: string; reason: string }> } {
  const inputs: IDogfoodContextInput[] = [];
  const closes: Array<{ recordId: string; reason: string }> = [];
  const port: IDogfoodContextPort = {
    prepare(input: IDogfoodContextInput): Promise<IDogfoodContextHandle> {
      inputs.push(input);
      const recordId = crypto.randomUUID();
      return Promise.resolve({ recordId, prompt, connectionId: connection?.connectionId, connection });
    },
    close(recordId: string, reason: string): Promise<void> {
      closes.push({ recordId, reason });
      return Promise.resolve();
    },
  };
  return { port, inputs, closes };
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

/** None of this file's tests set `portalAlias` on their request, so `prepareBrief` never
 *  calls this — it stands in only to satisfy the mandatory dependency. */
const NEVER_USED_WORKTREE_COORDINATOR: IFlowWorktreeCoordinator = {
  resolve: () => Promise.reject(new Error("not used")),
  release: () => Promise.resolve(),
  releaseAll: () => Promise.resolve(),
};

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
    portals: [],
    worktreeCoordinator: NEVER_USED_WORKTREE_COORDINATOR,
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

Deno.test("[session_delegation_coordinator] context lookup receives a bare model while the session brief preserves provider:model", async () => {
  const delegateService = new RecordingDelegateService();
  const waitStore = new RecordingWaitStore();
  const resultStore = new OutcomeResultStore();
  const launcher = new RecordingLauncher();
  const logger = new EventLogger({ outputs: [] });
  const { port, inputs } = makeContextPort("AUGMENTED CYCLE OBJECTIVE");
  const deps = makeDeps(delegateService, waitStore, resultStore, launcher, port);
  deps.resolveModel = () => Promise.resolve("claude-cli:claude-haiku-4-5");
  const coordinator = new SessionDelegationCoordinator(deps, logger);

  resultStore.status = "completed";
  resultStore.request = request();
  await coordinator.delegate(request());

  assertEquals(inputs[0].model, "claude-haiku-4-5");
  assertEquals(delegateService.prepared[0].model, "claude-cli:claude-haiku-4-5");
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

const HARDENED_CONFIG: SessionDelegateConfig = { ...CONFIG, harden_permissions: true };

function makeHardenedDeps(
  delegateService: RecordingDelegateService,
  waitStore: RecordingWaitStore,
  resultStore: OutcomeResultStore,
  launcher: RecordingLauncher,
  contextPort?: IDogfoodContextPort,
): ISessionDelegationCoordinatorDeps {
  return { ...makeDeps(delegateService, waitStore, resultStore, launcher, contextPort), config: HARDENED_CONFIG };
}

Deno.test("[session_delegation_coordinator][mcp] a connection reaches resolveHardenedLaunch as a config-free (no bearerToken) shape", async () => {
  const delegateService = new RecordingDelegateService();
  const waitStore = new RecordingWaitStore();
  const resultStore = new OutcomeResultStore();
  const launcher = new RecordingLauncher();
  const logger = new EventLogger({ outputs: [] });
  const { port } = makeContextPort("objective", TEST_CONNECTION);
  const coordinator = new SessionDelegationCoordinator(
    makeHardenedDeps(delegateService, waitStore, resultStore, launcher, port),
    logger,
  );

  resultStore.status = "completed";
  resultStore.request = request();
  await coordinator.delegate(request());

  assertEquals(delegateService.hardenedConnections.length, 1);
  const passed = delegateService.hardenedConnections[0];
  assertEquals(passed?.endpoint, TEST_CONNECTION.endpoint);
  assertEquals(passed?.bearerEnvVar, TEST_CONNECTION.bearerEnvVar);
  assertEquals(passed?.toolNames.toSorted(), ["query_relationships", "search_memory", "who_depends_on"]);
  assertEquals("bearerToken" in (passed ?? {}), false, "the credential VALUE must never reach launch-config builders");
});

Deno.test("[session_delegation_coordinator][mcp] the bearer credential VALUE reaches the launcher's env, merged with provider env", async () => {
  const delegateService = new RecordingDelegateService();
  const waitStore = new RecordingWaitStore();
  const resultStore = new OutcomeResultStore();
  const launcher = new RecordingLauncher();
  const logger = new EventLogger({ outputs: [] });
  const { port } = makeContextPort("objective", TEST_CONNECTION);
  const coordinator = new SessionDelegationCoordinator(
    makeHardenedDeps(delegateService, waitStore, resultStore, launcher, port),
    logger,
  );

  resultStore.status = "completed";
  resultStore.request = request();
  await coordinator.delegate(request());

  assertEquals(launcher.envs[0]?.[TEST_CONNECTION.bearerEnvVar], TEST_CONNECTION.bearerToken);
});

Deno.test("[session_delegation_coordinator][mcp] close() is called with COMPLETED when the delegation completes successfully", async () => {
  const delegateService = new RecordingDelegateService();
  const waitStore = new RecordingWaitStore();
  const resultStore = new OutcomeResultStore();
  const launcher = new RecordingLauncher();
  const logger = new EventLogger({ outputs: [] });
  const { port, closes } = makeContextPort("objective", TEST_CONNECTION);
  const coordinator = new SessionDelegationCoordinator(
    makeHardenedDeps(delegateService, waitStore, resultStore, launcher, port),
    logger,
  );

  resultStore.status = "completed";
  resultStore.request = request();
  await coordinator.delegate(request());

  assertEquals(closes.length, 1);
  assertEquals(closes[0].reason, "completed");
});

Deno.test("[session_delegation_coordinator][mcp] close() is called with CANCELLED when the delegation is cancelled", async () => {
  const delegateService = new RecordingDelegateService();
  const waitStore = new RecordingWaitStore();
  waitStore.status = "cancelled";
  const resultStore = new OutcomeResultStore();
  resultStore.status = null; // no outcome published — outcomeFromWait handles the cancelled wait
  const launcher = new RecordingLauncher();
  const logger = new EventLogger({ outputs: [] });
  const { port, closes } = makeContextPort("objective", TEST_CONNECTION);
  const coordinator = new SessionDelegationCoordinator(
    makeHardenedDeps(delegateService, waitStore, resultStore, launcher, port),
    logger,
  );

  const outcome = await coordinator.delegate(request());

  assertEquals(outcome.status, "cancelled");
  assertEquals(closes.length, 1);
  assertEquals(closes[0].reason, "cancelled");
});

Deno.test("[session_delegation_coordinator][mcp] closeAllOpenContextConnections closes every connection still tracked open", async () => {
  const delegateService = new RecordingDelegateService();
  const waitStore = new RecordingWaitStore();
  waitStore.status = "pending";
  const resultStore = new OutcomeResultStore();
  resultStore.status = null;
  const launcher = new RecordingLauncher();
  const logger = new EventLogger({ outputs: [] });
  const { port, closes } = makeContextPort("objective", TEST_CONNECTION);

  // A controlled sleep seam: the FIRST poll's sleep() call parks here (not yet
  // resolved), deterministically pausing awaitTerminal's loop mid-flight — no reliance
  // on real elapsed time or a race against a tight poll loop.
  let releaseFirstSleep: (() => void) | undefined;
  const firstSleep = new Promise<void>((resolve) => {
    releaseFirstSleep = resolve;
  });
  let sleepCalls = 0;
  const deps = makeHardenedDeps(delegateService, waitStore, resultStore, launcher, port);
  deps.sleep = () => {
    sleepCalls++;
    return sleepCalls === 1 ? firstSleep : Promise.resolve();
  };
  const coordinator = new SessionDelegationCoordinator(deps, logger);

  const delegatePromise = coordinator.delegate(request());
  // Yield the microtask queue until the loop has reached its first sleep() call
  // (bounded so a wiring regression fails fast instead of hanging the test run).
  for (let i = 0; i < 1000 && sleepCalls === 0; i++) {
    await Promise.resolve();
  }
  assertEquals(sleepCalls, 1, "awaitTerminal must have reached its first poll sleep by now");

  await coordinator.closeAllOpenContextConnections();
  assertEquals(closes.length, 1);
  assertEquals(closes[0].reason, "cancelled");

  // Unblock the parked loop iteration and let it observe a terminal outcome next poll.
  resultStore.status = "completed";
  resultStore.request = request();
  waitStore.status = "resumed";
  releaseFirstSleep!();
  await delegatePromise;
});
