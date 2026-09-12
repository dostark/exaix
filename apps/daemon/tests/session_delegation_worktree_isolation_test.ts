/**
 * @module SessionDelegationWorktreeIsolationTest
 * @path apps/daemon/tests/session_delegation_worktree_isolation_test.ts
 * @description Phase 194 Step 5 documented the session_delegate_cycle worktree-isolation
 * gap as an executable RED baseline; Step 6 wires FlowWorktreeCoordinator into
 * SessionDelegationCoordinator.prepareBrief and inverts that assertion to GREEN — a portal
 * opted into `execution_strategy: "worktree"` now gets a real, isolated per-parentTraceId
 * worktree, resolved through the REAL SessionDelegateService + createDefaultSessionAdapterRegistry()
 * (not a stub), never the plain shared checkout. Also covers the coordinator's fail-fast
 * construction guard and the unresolvable-portalAlias configuration error.
 * @architectural-layer Tests
 * @related-files [apps/daemon/src/session_delegation_coordinator.ts, packages/flow/src/flow_worktree_coordinator.ts, packages/flow/src/resolve_worktree_base_dir.ts]
 */

import { assertEquals, assertThrows } from "@std/assert";
import { join } from "@std/path";
import { FlowWorktreeCoordinator } from "@exaix/flow";
import { GitService } from "@exaix/git";
import { setupGitRepo, TEST_DEFAULT_BRANCH } from "@exaix/git/testing";
import { createMockConfig, createMockEventLogger } from "@exaix/testing";
import { PortalExecutionStrategy } from "@exaix/core";
import type { IFlowWorktreeCoordinator, IGitServiceFactory } from "@exaix/core/types";
import type { SessionBrief, SessionDelegateConfig, SessionWaitState } from "@exaix/schemas/session_delegate.ts";
import type { IPortalPermissions } from "@exaix/schemas/portal_permissions.ts";
import type { ISessionLaunch } from "@exaix/session/i_session_adapter.ts";
import { createDefaultSessionAdapterRegistry } from "@exaix/session/session_adapter_registry.ts";
import { SessionDelegateService } from "@exaix/session/session_delegate_service.ts";
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
import { SessionDelegationCoordinator } from "../src/session_delegation_coordinator.ts";

const FIXED_NOW = new Date("2026-09-12T00:00:00.000Z");
const PORTAL_ALIAS = "worktree-isolation-portal";
const CONFIG: SessionDelegateConfig = {
  enabled: true,
  tool: "claude-code",
  model: "anthropic:claude-sonnet-5",
  gates: ["code_changes"],
  launch_mode: "headless",
  permitted_paths: ["packages/**"],
  token_budget: { max_input_tokens: 1_000, max_output_tokens: 500, max_total_tokens: 1_500 },
  // Unhardened: these tests prove worktree-cwd resolution, not the hardening machinery —
  // resolveHardenedLaunch would additionally probe a real binary version.
  harden_permissions: false,
};

class ResumedWaitStore implements ISessionWaitStore {
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
    return this.get(traceId).then((state) => state!);
  }
  cancel(traceId: string): Promise<SessionWaitState> {
    return this.get(traceId).then((state) => state!);
  }
  get(traceId: string): Promise<SessionWaitState | undefined> {
    return Promise.resolve({
      trace_id: traceId,
      gate: "code_changes",
      resume_token: "resume-token",
      deadline: "2027-01-01T00:00:00.000Z",
      status: "resumed",
      decision: "changes_made",
      created_at: FIXED_NOW.toISOString(),
    });
  }
}

class CompletedResultStore implements ISessionDelegationResultStore {
  request: ISessionDelegationRequest | null = null;
  publishAccepted(): Promise<void> {
    return Promise.resolve();
  }
  publishRejected(): Promise<void> {
    return Promise.resolve();
  }
  get(traceId: string): Promise<ISessionDelegationOutcome | null> {
    if (!this.request) return Promise.resolve(null);
    return Promise.resolve(SessionDelegationOutcomeSchema.parse({
      delegationTraceId: traceId,
      parentTraceId: this.request.parentTraceId,
      parentStepId: this.request.parentStepId,
      sequence: this.request.sequence,
      status: "completed",
      decision: "changes_made",
      summary: "completed",
      pathsTouched: [],
      tokenStats: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    }));
  }
  getRecord(): Promise<ISessionDelegationResultRecord | null> {
    return Promise.resolve(null);
  }
  markDelivered(): Promise<boolean> {
    return Promise.resolve(true);
  }
}

/** Captures every real ISessionLaunch the coordinator resolved, without spawning any of them. */
class CapturingLauncher {
  captured: ISessionLaunch[] = [];
  launch(launch: ISessionLaunch): Promise<void> {
    this.captured.push(launch);
    return Promise.resolve();
  }
}

function portalConfig(overrides: Partial<IPortalPermissions> = {}): IPortalPermissions {
  return {
    alias: PORTAL_ALIAS,
    target_path: "/unused-in-these-tests",
    default_branch: TEST_DEFAULT_BRANCH,
    agents_allowed: ["*"],
    operations: [],
    ...overrides,
  };
}

function request(overrides: Partial<ISessionDelegationRequest> = {}): ISessionDelegationRequest {
  return {
    parentTraceId: crypto.randomUUID(),
    parentStepId: "1",
    sequence: 1,
    agentRole: "dogfood-coder",
    objective: "add a hello file",
    acceptanceCriteria: [],
    artifactRef: "trace:test/step:1",
    portalAlias: PORTAL_ALIAS,
    // Today's real resolveCycleExecutionContext behavior before this phase's fix: the
    // portal's raw, plain-checkout target_path. prepareBrief now overrides this with a
    // resolved worktree path whenever portalAlias is present.
    worktreePath: "/unused-in-these-tests",
    ...overrides,
  };
}

/** Minimal never-invoked stand-in for tests that only exercise the fail-fast constructor guard. */
const NEVER_USED_WORKTREE_COORDINATOR: IFlowWorktreeCoordinator = {
  resolve: () => Promise.reject(new Error("not used")),
  release: () => Promise.resolve(),
  releaseAll: () => Promise.resolve(),
};

Deno.test("[security] SessionDelegationCoordinator construction throws when deps.portals is omitted", () => {
  assertThrows(
    () =>
      new SessionDelegationCoordinator(
        {
          config: CONFIG,
          delegateService: { prepareBrief: () => Promise.reject(new Error("not used")) } as never,
          waitStore: new ResumedWaitStore(),
          resultStore: new CompletedResultStore(),
          launcher: new CapturingLauncher(),
          resolveModel: () => Promise.resolve(undefined),
          resolveProviderApiKey: () => undefined,
          now: () => FIXED_NOW,
          sleep: () => Promise.resolve(),
          worktreeCoordinator: NEVER_USED_WORKTREE_COORDINATOR,
        } as never,
        createMockEventLogger(),
      ),
    Error,
    "portals",
  );
});

Deno.test("[security] SessionDelegationCoordinator construction throws when deps.worktreeCoordinator is omitted", () => {
  assertThrows(
    () =>
      new SessionDelegationCoordinator(
        {
          config: CONFIG,
          delegateService: { prepareBrief: () => Promise.reject(new Error("not used")) } as never,
          waitStore: new ResumedWaitStore(),
          resultStore: new CompletedResultStore(),
          launcher: new CapturingLauncher(),
          resolveModel: () => Promise.resolve(undefined),
          resolveProviderApiKey: () => undefined,
          now: () => FIXED_NOW,
          sleep: () => Promise.resolve(),
          portals: [],
        } as never,
        createMockEventLogger(),
      ),
    Error,
    "worktreeCoordinator",
  );
});

Deno.test(
  "[security] SessionDelegationCoordinator.delegate: an unresolvable portalAlias throws a clear configuration error, never silently falls back to input.worktreePath",
  async () => {
    let prepareBriefCalls = 0;
    const coordinator = new SessionDelegationCoordinator(
      {
        config: CONFIG,
        delegateService: {
          prepareBrief: () => {
            prepareBriefCalls += 1;
            return Promise.reject(new Error("must not be reached"));
          },
        } as never,
        waitStore: new ResumedWaitStore(),
        resultStore: new CompletedResultStore(),
        launcher: new CapturingLauncher(),
        resolveModel: () => Promise.resolve(undefined),
        resolveProviderApiKey: () => undefined,
        now: () => FIXED_NOW,
        sleep: () => Promise.resolve(),
        portals: [],
        worktreeCoordinator: NEVER_USED_WORKTREE_COORDINATOR,
      },
      createMockEventLogger(),
    );

    // The load-bearing assertion below is that prepareBrief is never reached — the
    // configuration error fires before any fallback to input.worktreePath could occur.
    const outcome = await coordinator.delegate(request({ portalAlias: "does-not-exist" }));

    assertEquals(outcome.status, "launch_failed");
    assertEquals(prepareBriefCalls, 0, "prepareBrief on the delegate service must never be reached");
  },
);

Deno.test(
  "[security] SessionDelegationCoordinator.delegate against a WORKTREE-strategy portal launches the delegate CLI with cwd under .exa/worktrees/<portal>/<parentTraceId>/, never the plain checkout",
  async () => {
    const systemRoot = await Deno.makeTempDir({ prefix: "phase194-step6-root-" });
    const portalDir = await Deno.makeTempDir({ prefix: "phase194-step6-plain-checkout-" });
    const sessionDir = await Deno.makeTempDir({ prefix: "phase194-step6-session-" });
    try {
      await setupGitRepo(portalDir, { initialCommit: true, branch: TEST_DEFAULT_BRANCH });

      const config = createMockConfig(systemRoot, {
        portals: [portalConfig({ target_path: portalDir, execution_strategy: PortalExecutionStrategy.WORKTREE })],
      });
      const logger = createMockEventLogger();
      const gitServiceFactory: IGitServiceFactory = {
        createGitService: (repoPath: string, traceId: string) => new GitService({ config, traceId, repoPath }),
      };
      const worktreeCoordinator = new FlowWorktreeCoordinator({ config, gitServiceFactory, logger });

      // The REAL production delegate service + the REAL shipped adapter registry — the
      // exact chain packages/session/src/session_adapter_registry.ts:87
      // (`cwd: brief.worktree_path ?? dirname(briefPath)`) that resolves the launch's cwd.
      const delegateService = new SessionDelegateService({
        registry: createDefaultSessionAdapterRegistry(),
        clock: { now: () => FIXED_NOW },
        sessionDir,
      });
      const resultStore = new CompletedResultStore();
      const launcher = new CapturingLauncher();

      const coordinator = new SessionDelegationCoordinator(
        {
          config: CONFIG,
          delegateService,
          waitStore: new ResumedWaitStore(),
          resultStore,
          launcher,
          resolveModel: () => Promise.resolve(undefined),
          resolveProviderApiKey: () => undefined,
          now: () => FIXED_NOW,
          sleep: () => Promise.resolve(),
          portals: config.portals,
          worktreeCoordinator,
        },
        logger,
      );

      const req = request({ worktreePath: portalDir });
      resultStore.request = req;

      const outcome = await coordinator.delegate(req);

      const expectedWorktreeDir = join(systemRoot, ".exa", "worktrees", PORTAL_ALIAS, req.parentTraceId);
      assertEquals(outcome.status, "completed");
      assertEquals(
        launcher.captured[0]?.cwd,
        expectedWorktreeDir,
        "the delegated CLI's cwd must be the resolved per-trace worktree, not the plain checkout",
      );
      const worktreeIsRealGitCheckout = await Deno.stat(join(expectedWorktreeDir, ".git")).then(() => true).catch(() =>
        false
      );
      assertEquals(
        worktreeIsRealGitCheckout,
        true,
        "the resolved directory must be a real git worktree, not a bare dir",
      );
    } finally {
      await Deno.remove(systemRoot, { recursive: true }).catch(() => {});
      await Deno.remove(portalDir, { recursive: true }).catch(() => {});
      await Deno.remove(sessionDir, { recursive: true }).catch(() => {});
    }
  },
);

Deno.test(
  "[security] SessionDelegationCoordinator.delegate: two calls sharing a parentTraceId (sequence 1 then 2 of one session_delegate_cycle run) reuse the SAME worktree path",
  async () => {
    const systemRoot = await Deno.makeTempDir({ prefix: "phase194-step6-reuse-root-" });
    const portalDir = await Deno.makeTempDir({ prefix: "phase194-step6-reuse-portal-" });
    const sessionDir = await Deno.makeTempDir({ prefix: "phase194-step6-reuse-session-" });
    try {
      await setupGitRepo(portalDir, { initialCommit: true, branch: TEST_DEFAULT_BRANCH });

      const config = createMockConfig(systemRoot, {
        portals: [portalConfig({ target_path: portalDir, execution_strategy: PortalExecutionStrategy.WORKTREE })],
      });
      const logger = createMockEventLogger();
      const gitServiceFactory: IGitServiceFactory = {
        createGitService: (repoPath: string, traceId: string) => new GitService({ config, traceId, repoPath }),
      };
      const worktreeCoordinator = new FlowWorktreeCoordinator({ config, gitServiceFactory, logger });
      const delegateService = new SessionDelegateService({
        registry: createDefaultSessionAdapterRegistry(),
        clock: { now: () => FIXED_NOW },
        sessionDir,
      });
      const resultStore = new CompletedResultStore();
      const launcher = new CapturingLauncher();

      const coordinator = new SessionDelegationCoordinator(
        {
          config: CONFIG,
          delegateService,
          waitStore: new ResumedWaitStore(),
          resultStore,
          launcher,
          resolveModel: () => Promise.resolve(undefined),
          resolveProviderApiKey: () => undefined,
          now: () => FIXED_NOW,
          sleep: () => Promise.resolve(),
          portals: config.portals,
          worktreeCoordinator,
        },
        logger,
      );

      const parentTraceId = crypto.randomUUID();
      const firstReq = request({ parentTraceId, sequence: 1, worktreePath: portalDir });
      resultStore.request = firstReq;
      await coordinator.delegate(firstReq);

      const secondReq = request({ parentTraceId, sequence: 2, worktreePath: portalDir });
      resultStore.request = secondReq;
      await coordinator.delegate(secondReq);

      assertEquals(launcher.captured.length, 2);
      assertEquals(
        launcher.captured[1]?.cwd,
        launcher.captured[0]?.cwd,
        "both sequences of one session_delegate_cycle run must reuse the identical worktree",
      );
    } finally {
      await Deno.remove(systemRoot, { recursive: true }).catch(() => {});
      await Deno.remove(portalDir, { recursive: true }).catch(() => {});
      await Deno.remove(sessionDir, { recursive: true }).catch(() => {});
    }
  },
);
