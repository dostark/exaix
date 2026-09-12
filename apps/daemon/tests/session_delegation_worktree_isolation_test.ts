/**
 * @module SessionDelegationWorktreeIsolationTest
 * @path apps/daemon/tests/session_delegation_worktree_isolation_test.ts
 * @description Phase 194 Step 5 — RED-first proof of the session_delegate_cycle worktree
 * isolation gap. Drives SessionDelegationCoordinator.delegate through the REAL
 * SessionDelegateService + createDefaultSessionAdapterRegistry() (not a stub), against a
 * portal whose worktreePath is a plain git checkout — not a `.exa/worktrees/<portal>/
 * <traceId>` path. Today, no code between resolveCycleExecutionContext and the launched
 * subprocess ever calls IGitService.addWorktree or creates an isolated directory; the
 * delegated CLI's cwd resolves to the plain checkout verbatim
 * (BuiltinSessionAdapter.buildLaunch: `cwd: brief.worktree_path ?? dirname(briefPath)`).
 * This test documents that CURRENT, unsafe behavior as an executable regression baseline —
 * Phase 194 Step 6 inverts its assertion once FlowWorktreeCoordinator is wired into
 * SessionDelegationCoordinator.prepareBrief.
 * @architectural-layer Tests
 * @related-files [apps/daemon/src/session_delegation_coordinator.ts, packages/session/src/session_delegate_service.ts, packages/session/src/session_adapter_registry.ts]
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { setupGitRepo, TEST_DEFAULT_BRANCH } from "@exaix/git/testing";
import { createMockEventLogger } from "@exaix/testing";
import type { SessionBrief, SessionDelegateConfig, SessionWaitState } from "@exaix/schemas/session_delegate.ts";
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
const CONFIG: SessionDelegateConfig = {
  enabled: true,
  tool: "claude-code",
  model: "anthropic:claude-sonnet-5",
  gates: ["code_changes"],
  launch_mode: "headless",
  permitted_paths: ["packages/**"],
  token_budget: { max_input_tokens: 1_000, max_output_tokens: 500, max_total_tokens: 1_500 },
  // Unhardened: this RED test proves the cwd-resolution gap itself, not the hardening
  // machinery — resolveHardenedLaunch would additionally probe a real binary version.
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

/** Captures the real ISessionLaunch the coordinator resolved, without spawning it. */
class CapturingLauncher {
  captured: ISessionLaunch | undefined;
  launch(launch: ISessionLaunch): Promise<void> {
    this.captured = launch;
    return Promise.resolve();
  }
}

Deno.test(
  "[security][RED] SessionDelegationCoordinator.delegate against a plain (non-worktree) portal target_path launches the delegate CLI with cwd = the plain shared checkout, not an isolated directory",
  async () => {
    const portalDir = await Deno.makeTempDir({ prefix: "phase194-step5-plain-checkout-" });
    const sessionDir = await Deno.makeTempDir({ prefix: "phase194-step5-session-" });
    try {
      await setupGitRepo(portalDir, { initialCommit: true, branch: TEST_DEFAULT_BRANCH });

      // The REAL production delegate service + the REAL shipped adapter registry — the
      // exact chain packages/session/src/session_adapter_registry.ts:87
      // (`cwd: brief.worktree_path ?? dirname(briefPath)`) resolves cwd through today.
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
        },
        createMockEventLogger(),
      );

      const req: ISessionDelegationRequest = {
        parentTraceId: crypto.randomUUID(),
        parentStepId: "1",
        sequence: 1,
        agentRole: "dogfood-coder",
        objective: "add a hello file",
        acceptanceCriteria: [],
        artifactRef: "trace:test/step:1",
        // Today's actual resolveCycleExecutionContext behavior: the portal's raw,
        // plain-checkout target_path — never a `.exa/worktrees/<portal>/<traceId>` path.
        worktreePath: portalDir,
      };
      resultStore.request = req;

      const outcome = await coordinator.delegate(req);

      assertEquals(outcome.status, "completed");
      assertEquals(
        launcher.captured?.cwd,
        portalDir,
        "documents today's unsafe behavior: the delegated CLI's cwd is the portal's own " +
          "plain checkout, verbatim — no per-trace worktree isolation exists yet",
      );
      const worktreeMarkerExists = await Deno.stat(join(portalDir, ".exa", "worktrees")).then(() => true).catch(() =>
        false
      );
      assertEquals(worktreeMarkerExists, false, "no .exa/worktrees directory is created anywhere in this path today");
    } finally {
      await Deno.remove(portalDir, { recursive: true }).catch(() => {});
      await Deno.remove(sessionDir, { recursive: true }).catch(() => {});
    }
  },
);
