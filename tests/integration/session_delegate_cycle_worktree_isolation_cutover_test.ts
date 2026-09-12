/**
 * @module SessionDelegateCycleWorktreeIsolationCutoverTest
 * @path tests/integration/session_delegate_cycle_worktree_isolation_cutover_test.ts
 * @description Phase 194 Step 7 — deterministic, cost-free proof that a session_delegate_cycle
 * request against a portal whose target_path is a PLAIN, non-worktree git checkout (the
 * exact configuration this phase's Executive Summary diagnosis proved silently unsafe)
 * writes into a per-parentTraceId `.exa/worktrees/<portal>/<traceId>/` checkout, never the
 * plain checkout itself. Drives the real production chain — RequestProcessor -> FlowRunner
 * -> SessionDelegateCycleStepHandler -> SessionDelegationCoordinator -> SessionDelegateService
 * -> HeadlessSessionLauncher, with a real FlowWorktreeCoordinator + GitService resolving the
 * worktree. Only the delegate CLI binary itself is swapped for a deterministic fixture
 * script, so the test needs no live API call.
 * @architectural-layer Integration
 * @dependencies [@exaix/flow, @exaix/session, @exaix/git, @exaix/request, @exaix/core]
 * @related-files [apps/daemon/src/session_delegation_coordinator.ts, packages/flow/src/step_handlers/session_delegate_cycle_step_handler.ts, apps/daemon/src/headless_session_launcher.ts]
 */

import { assert, assertEquals } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import {
  FlowInputSource,
  FlowOutputFormat,
  FlowStepExecutionMode,
  FlowStepType,
  PortalExecutionStrategy,
  PricingTier,
  ProviderCostTier,
} from "@exaix/core";
import { FlowGateAction } from "@exaix/core";
import { RequestProcessor } from "@exaix/request";
import { AgentRunner } from "@exaix/execution";
import { FlowRunner, FlowWorktreeCoordinator, PlanContextResolver } from "@exaix/flow";
import { GitService } from "@exaix/git";
import { setupGitRepo, TEST_DEFAULT_BRANCH } from "@exaix/git/testing";
import { ProviderRegistry } from "@exaix/ai";
import { MockProviderFactory } from "@exaix/ai/factories/mock_factory.ts";
import { CostTracker } from "@exaix/core/cost";
import type {
  IApplicationContext,
  IFlowWorktreeCoordinator,
  IGateConfig,
  IGateEvaluator,
  IGateResult,
  IGitServiceFactory,
} from "@exaix/core/types";
import type { IFlow } from "@exaix/schemas/flow.ts";
import type { SessionBrief, SessionDelegateConfig, SessionWaitState } from "@exaix/schemas/session_delegate.ts";
import { BuiltinSessionAdapter, SessionAdapterRegistry } from "@exaix/session/session_adapter_registry.ts";
import { SessionDelegateService } from "@exaix/session/session_delegate_service.ts";
import type { ISessionWaitStore } from "@exaix/session/wait/i_session_wait_store.ts";
import { type ISessionDelegationOutcome, SessionDelegationOutcomeSchema } from "@exaix/session/session_delegation.ts";
import type {
  ISessionDelegationResultRecord,
  ISessionDelegationResultStore,
} from "@exaix/session/session_delegation_result_store.ts";
import { SessionDelegationCoordinator } from "../../apps/daemon/src/session_delegation_coordinator.ts";
import { HeadlessSessionLauncher } from "../../apps/daemon/src/headless_session_launcher.ts";
import {
  createMockEventLogger,
  createStubConfig,
  createStubDisplay,
  createStubGit,
  createStubProvider,
  getWorkspaceDir,
  getWorkspaceRequestsDir,
  initTestDbService,
} from "@exaix/testing";

const FIXTURE_BIN = fromFileUrl(
  new URL("./fixtures/session_delegate_cycle_worktree_isolation_fixture.ts", import.meta.url),
);
const PORTAL_ALIAS = "exaix-self";
const FIXED_NOW = new Date("2026-09-12T00:00:00.000Z");
const SESSION_DELEGATE_CONFIG: SessionDelegateConfig = {
  enabled: true,
  tool: "codex",
  gates: ["code_changes"],
  launch_mode: "headless",
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

/** Unconditionally reports the delegation as completed — this test proves WHERE the
 *  delegate's write lands, not the governance reconciliation of its declared outcome. */
class CompletedResultStore implements ISessionDelegationResultStore {
  publishAccepted(): Promise<void> {
    return Promise.resolve();
  }
  publishRejected(): Promise<void> {
    return Promise.resolve();
  }
  get(traceId: string): Promise<ISessionDelegationOutcome | null> {
    return Promise.resolve(SessionDelegationOutcomeSchema.parse({
      delegationTraceId: traceId,
      parentTraceId: crypto.randomUUID(),
      parentStepId: "next-steps",
      sequence: 1,
      status: "completed",
      decision: "changes_made",
      summary: "implemented the fixture step",
      pathsTouched: ["src/proof.txt"],
    }));
  }
  getRecord(): Promise<ISessionDelegationResultRecord | null> {
    return Promise.resolve(null);
  }
  markDelivered(): Promise<boolean> {
    return Promise.resolve(true);
  }
}

class AlwaysPassGateEvaluator implements IGateEvaluator {
  evaluate(_config: IGateConfig): Promise<IGateResult> {
    return Promise.resolve({
      passed: true,
      score: 1,
      evaluation: { score: 1, passed: true, feedback: "ok", criteriaScores: {} } as never,
      attempts: 1,
      action: FlowGateAction.PASSED,
      evaluationDurationMs: 0,
    });
  }
}

function makeCycleFlow(): IFlow {
  return {
    id: "worktree-isolation-cycle-flow",
    name: "Worktree Isolation Cycle Flow",
    description: "test",
    version: "1.0",
    steps: [{
      id: "next-steps",
      name: "Next Steps",
      type: FlowStepType.SESSION_DELEGATE_CYCLE,
      agent_role: "senior-coder",
      execution_mode: FlowStepExecutionMode.DECLARED,
      dependsOn: [],
      input: { source: FlowInputSource.REQUEST, transform: "passthrough" },
      retry: { maxAttempts: 1, backoffMs: 1000 },
      delegateCycle: {
        requireChangedPaths: true,
        review: {
          agent_role: "senior-reviewer",
          criteria: ["correctness"],
          threshold: 0.8,
          onFail: "halt",
          maxRetries: 3,
          includeRequestCriteria: false,
        },
      },
    }],
    output: { from: "next-steps", format: FlowOutputFormat.MARKDOWN },
    settings: { maxParallelism: 1, failFast: true, includeRequestCriteria: false },
  } as IFlow;
}

Deno.test({
  name:
    "[integration] a real daemon composition processing a session_delegate_cycle request against a PLAIN (non-worktree) portal writes to .exa/worktrees/<portal>/<parentTraceId>/, never the plain checkout",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const { tempDir: systemRoot, db, config, cleanup: cleanupDb } = await initTestDbService();
    const costTracker = new CostTracker(db, config);
    const portalDir = await Deno.makeTempDir({ prefix: "phase194-step7-plain-checkout-" });
    const sessionDir = await Deno.makeTempDir({ prefix: "phase194-step7-session-" });
    try {
      await setupGitRepo(portalDir, { initialCommit: true, branch: TEST_DEFAULT_BRANCH });

      await Deno.mkdir(getWorkspaceRequestsDir(systemRoot), { recursive: true });
      await Deno.mkdir(join(systemRoot, "Blueprints", "Agents"), { recursive: true });
      const planContextDir = join(portalDir, ".exa", "PlanContext");
      await Deno.mkdir(planContextDir, { recursive: true });
      await Deno.writeTextFile(
        join(planContextDir, "phase-194.md"),
        "## Step 1\n\n**Actions:**\n- Do the thing\n\n```yaml\n# step-manifest\nstep: 1\ntitle: Do the thing\n```\n",
      );

      config.session_delegate = SESSION_DELEGATE_CONFIG;
      // The exact configuration this phase's diagnosis proved silently unsafe: target_path
      // is a plain, live git checkout — never pre-pointed at a worktree by config.
      config.portals = [{
        alias: PORTAL_ALIAS,
        target_path: portalDir,
        default_branch: TEST_DEFAULT_BRANCH,
        execution_strategy: PortalExecutionStrategy.WORKTREE,
        agents_allowed: ["*"],
        operations: [],
      }];

      ProviderRegistry.clear();
      ProviderRegistry.registerWithMetadata("mock", new MockProviderFactory(), {
        name: "mock",
        costTier: ProviderCostTier.FREE,
        pricingTier: PricingTier.FREE,
        capabilities: ["chat"],
        description: "Mock provider for testing",
        strengths: ["fast", "reliable", "deterministic"],
      });

      const logger = createMockEventLogger();
      const gitServiceFactory: IGitServiceFactory = {
        createGitService: (repoPath: string, traceId: string) => new GitService({ config, traceId, repoPath }),
      };
      const worktreeCoordinator: IFlowWorktreeCoordinator = new FlowWorktreeCoordinator({
        config,
        gitServiceFactory,
        logger,
      });

      // A real BuiltinSessionAdapter (the exact production cwd-resolution logic), with only
      // the spawned binary swapped for a deterministic fixture — no live CLI/API cost.
      const registry = new SessionAdapterRegistry();
      registry.register(new BuiltinSessionAdapter("codex", FIXTURE_BIN, false, true));
      const delegateService = new SessionDelegateService({
        registry,
        clock: { now: () => FIXED_NOW },
        sessionDir,
      });
      const launcher = new HeadlessSessionLauncher({ sessionDir, allowlist: new Set([FIXTURE_BIN]) });

      const sessionDelegationCoordinator = new SessionDelegationCoordinator(
        {
          config: config.session_delegate,
          delegateService,
          waitStore: new ResumedWaitStore(),
          resultStore: new CompletedResultStore(),
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

      const provider = createStubProvider("<thought>ok</thought><content>{}</content>");
      const context: IApplicationContext = {
        config: createStubConfig(config),
        db,
        provider,
        git: createStubGit(),
        display: createStubDisplay(db),
      };
      const flowRunner = new FlowRunner({
        agentExecutor: { run: () => Promise.resolve({ thought: "", content: "", raw: "" }) },
        eventLogger: { log: () => {} },
        gateEvaluator: new AlwaysPassGateEvaluator(),
        sessionDelegationCoordinator,
        planContextResolver: new PlanContextResolver(),
      });

      const processor = new RequestProcessor({
        workspacePath: getWorkspaceDir(systemRoot),
        requestsDir: getWorkspaceRequestsDir(systemRoot),
        blueprintsPath: join(systemRoot, "Blueprints", "Agents"),
        includeReasoning: true,
        context,
        costTracker,
        agentRunner: new AgentRunner(provider),
        flowRunner,
        flowLoader: { loadFlow: () => Promise.resolve(makeCycleFlow()) },
      });

      const traceId = crypto.randomUUID();
      const requestPath = join(getWorkspaceRequestsDir(systemRoot), `request-${traceId.slice(0, 8)}.md`);
      await Deno.writeTextFile(
        requestPath,
        [
          "---",
          `trace_id: "${traceId}"`,
          `created: "${new Date().toISOString()}"`,
          "status: pending",
          "priority: high",
          "flow: worktree-isolation-cycle-flow",
          `portal: ${PORTAL_ALIAS}`,
          "plan_context_ref: .exa/PlanContext/phase-194.md",
          "source: cli",
          'created_by: "test@example.com"',
          "---",
          "",
          "Run the cycle.",
          "",
        ].join("\n"),
      );

      await processor.process(requestPath);

      const expectedWorktreeFile = join(systemRoot, ".exa", "worktrees", PORTAL_ALIAS, traceId, "src", "proof.txt");
      const worktreeFileExists = await Deno.stat(expectedWorktreeFile).then(() => true).catch(() => false);
      const portalFileExists = await Deno.stat(join(portalDir, "src", "proof.txt")).then(() => true).catch(() => false);

      assert(worktreeFileExists, `expected the delegated write under ${expectedWorktreeFile}`);
      assertEquals(portalFileExists, false, "the portal's own plain checkout must receive ZERO changes");
    } finally {
      ProviderRegistry.clear();
      await costTracker.flush();
      await cleanupDb();
      await Deno.remove(portalDir, { recursive: true }).catch(() => {});
      await Deno.remove(sessionDir, { recursive: true }).catch(() => {});
    }
  },
});
