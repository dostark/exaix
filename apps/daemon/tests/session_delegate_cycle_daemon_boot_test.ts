/**
 * @module SessionDelegateCycleDaemonBootTest
 * @path apps/daemon/tests/session_delegate_cycle_daemon_boot_test.ts
 * @description Phase 174 Step 2 [daemon] test: with session_delegate.enabled=true and
 *   the code_changes gate configured, the SAME construction sequence main.ts uses
 *   (SessionDelegationCoordinator built once, passed into FlowRunner alongside a
 *   PlanContextResolver so SessionDelegateCycleStepHandler self-registers) carries a
 *   real request through RequestProcessor.process() -> FlowRunner.execute() -> the
 *   production-constructed handler -> the coordinator, for a one-step PlanContext fixture.
 * @architectural-layer Tests
 * @related-files [apps/daemon/main.ts, apps/daemon/src/session_delegation_coordinator.ts, packages/flow/src/step_handlers/session_delegate_cycle_step_handler.ts]
 */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { PricingTier, ProviderCostTier } from "@exaix/core";
import { FlowInputSource, FlowOutputFormat, FlowStepExecutionMode, FlowStepType } from "@exaix/core";
import { FlowGateAction } from "@exaix/core";
import { RequestProcessor } from "@exaix/request";
import { AgentRunner } from "@exaix/execution";
import { FlowRunner, PlanContextResolver } from "@exaix/flow";
import { ProviderRegistry } from "@exaix/ai";
import { MockProviderFactory } from "@exaix/ai/factories/mock_factory.ts";
import { CostTracker } from "@exaix/core/cost";
import type { IApplicationContext, IGateConfig, IGateEvaluator, IGateResult } from "@exaix/core/types";
import type { IFlow } from "@exaix/schemas/flow.ts";
import type { SessionBrief, SessionDelegateConfig, SessionWaitState } from "@exaix/schemas/session_delegate.ts";
import { SessionBriefSchema } from "@exaix/schemas/session_delegate.ts";
import type { ISessionLaunch } from "@exaix/session/i_session_adapter.ts";
import type {
  IHardenedLaunchResult,
  IPrepareBriefInput,
  ISessionDelegateService,
} from "@exaix/session/i_session_delegate.ts";
import type { ISessionWaitStore } from "@exaix/session/wait/i_session_wait_store.ts";
import { type ISessionDelegationOutcome, SessionDelegationOutcomeSchema } from "@exaix/session/session_delegation.ts";
import type {
  ISessionDelegationResultRecord,
  ISessionDelegationResultStore,
} from "@exaix/session/session_delegation_result_store.ts";
import type { IEventLogger } from "@exaix/core/logger";
import { SessionDelegationCoordinator } from "../src/session_delegation_coordinator.ts";
import {
  createStubConfig,
  createStubDisplay,
  createStubGit,
  createStubProvider,
  getWorkspaceDir,
  getWorkspaceRequestsDir,
  initTestDbService,
} from "@exaix/testing";

const FIXED_NOW = new Date("2026-08-28T12:00:00.000Z");
const SESSION_DELEGATE_CONFIG: SessionDelegateConfig = {
  enabled: true,
  tool: "codex",
  gates: ["code_changes"],
  launch_mode: "headless",
  harden_permissions: false,
};

class FakeDelegateService implements ISessionDelegateService {
  prepareBrief(input: IPrepareBriefInput): Promise<SessionBrief> {
    return Promise.resolve(SessionBriefSchema.parse({
      trace_id: input.traceId,
      parent_trace_id: input.parentTraceId,
      parent_step_id: input.parentStepId,
      sequence: input.sequence,
      identity_id: input.identityId,
      gate: input.gate,
      tool: input.tool,
      objective: input.objective,
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

class FakeWaitStore implements ISessionWaitStore {
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
    return this.get(traceId).then((s) => s!);
  }
  cancel(traceId: string): Promise<SessionWaitState> {
    return this.get(traceId).then((s) => s!);
  }
  get(traceId: string): Promise<SessionWaitState | undefined> {
    return Promise.resolve({
      trace_id: traceId,
      gate: "code_changes",
      resume_token: "resume-token",
      deadline: "2026-12-31T00:00:00.000Z",
      status: "resumed",
      decision: "changes_made",
      created_at: FIXED_NOW.toISOString(),
    });
  }
}

class FakeResultStore implements ISessionDelegationResultStore {
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
      pathsTouched: ["packages/flow/src/example.ts"],
    }));
  }
  getRecord(): Promise<ISessionDelegationResultRecord | null> {
    return Promise.resolve(null);
  }
  markDelivered(): Promise<boolean> {
    return Promise.resolve(true);
  }
}

class FakeLauncher {
  calls = 0;
  launch(): Promise<void> {
    this.calls += 1;
    return Promise.resolve();
  }
}

const noopLogger: IEventLogger = {
  log: () => Promise.resolve(),
  info: () => Promise.resolve(),
  warn: () => Promise.resolve(),
  error: () => Promise.resolve(),
  fatal: () => Promise.resolve(),
  debug: () => Promise.resolve(),
  child: () => noopLogger,
};

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
    id: "dogfood-meta-workflow",
    name: "Dogfood Meta Workflow",
    description: "test",
    version: "1.0",
    steps: [{
      id: "next-steps",
      name: "Next Steps",
      type: FlowStepType.SESSION_DELEGATE_CYCLE,
      identity: "senior-coder",
      execution_mode: FlowStepExecutionMode.DECLARED,
      dependsOn: [],
      input: { source: FlowInputSource.REQUEST, transform: "passthrough" },
      retry: { maxAttempts: 1, backoffMs: 1000 },
      delegateCycle: {
        requireChangedPaths: true,
        review: {
          identity: "senior-reviewer",
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

Deno.test("[daemon] boot with session_delegate.enabled=true executes the fixture through the production-constructed handler", async () => {
  const { tempDir, db, config, cleanup } = await initTestDbService();
  const costTracker = new CostTracker(db, config);
  try {
    await Deno.mkdir(getWorkspaceRequestsDir(tempDir), { recursive: true });
    await Deno.mkdir(join(tempDir, "Blueprints", "Agents"), { recursive: true });

    const portalRoot = await Deno.makeTempDir({ prefix: "daemon-boot-portal-" });
    const planContextDir = join(portalRoot, ".exa", "PlanContext");
    await Deno.mkdir(planContextDir, { recursive: true });
    await Deno.writeTextFile(
      join(planContextDir, "phase-174.md"),
      "## Step 1\n\n**Actions:**\n- Do the thing\n\n```yaml\n# step-manifest\nstep: 1\ntitle: Do the thing\n```\n",
    );

    config.session_delegate = SESSION_DELEGATE_CONFIG;
    config.portals = [{ alias: "exaix-self", target_path: portalRoot } as never];

    ProviderRegistry.clear();
    ProviderRegistry.registerWithMetadata("mock", new MockProviderFactory(), {
      name: "mock",
      costTier: ProviderCostTier.FREE,
      pricingTier: PricingTier.FREE,
      capabilities: ["chat"],
      description: "Mock provider for testing",
      strengths: ["fast", "reliable", "deterministic"],
    });

    // Mirrors apps/daemon/main.ts:main's exact conditional construction sequence.
    const resultStore = new FakeResultStore();
    const launcher = new FakeLauncher();
    const sessionDelegationCoordinator = config.session_delegate?.enabled &&
        config.session_delegate.gates.includes("code_changes")
      ? new SessionDelegationCoordinator({
        config: config.session_delegate,
        delegateService: new FakeDelegateService(),
        waitStore: new FakeWaitStore(),
        resultStore,
        launcher,
        resolveModel: () => Promise.resolve(undefined),
        resolveProviderApiKey: () => undefined,
        now: () => FIXED_NOW,
        sleep: () => Promise.resolve(),
      }, noopLogger)
      : undefined;
    assert(sessionDelegationCoordinator, "test setup must actually enable session delegation");

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
      workspacePath: getWorkspaceDir(tempDir),
      requestsDir: getWorkspaceRequestsDir(tempDir),
      blueprintsPath: join(tempDir, "Blueprints", "Agents"),
      includeReasoning: true,
      context,
      costTracker,
      agentRunner: new AgentRunner(provider),
      flowRunner,
      flowLoader: { loadFlow: () => Promise.resolve(makeCycleFlow()) },
    });

    const traceId = crypto.randomUUID();
    const requestPath = join(getWorkspaceRequestsDir(tempDir), `request-${traceId.slice(0, 8)}.md`);
    await Deno.writeTextFile(
      requestPath,
      [
        "---",
        `trace_id: "${traceId}"`,
        `created: "${new Date().toISOString()}"`,
        "status: pending",
        "priority: high",
        "flow: dogfood-meta-workflow",
        "portal: exaix-self",
        "plan_context_ref: .exa/PlanContext/phase-174.md",
        "source: cli",
        'created_by: "test@example.com"',
        "---",
        "",
        "Run the cycle.",
        "",
      ].join("\n"),
    );

    await processor.process(requestPath);

    // The production-constructed SessionDelegateCycleStepHandler reached the real
    // SessionDelegationCoordinator, which launched exactly one delegation for the
    // fixture's single step — the reachability this test exists to prove.
    assertEquals(launcher.calls, 1, "the real coordinator must have launched exactly one delegation");
  } finally {
    ProviderRegistry.clear();
    await costTracker.flush();
    await cleanup();
  }
});
