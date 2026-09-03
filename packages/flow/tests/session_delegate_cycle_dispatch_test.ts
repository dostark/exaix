/**
 * @module SessionDelegateCycleDispatchTest
 * @path packages/flow/tests/session_delegate_cycle_dispatch_test.ts
 * @description Phase 174 Step 2 integration and restart tests: a real FlowRunner
 *   dispatches a session_delegate_cycle step to SessionDelegateCycleStepHandler and the
 *   injected coordinator for a one-step PlanContext fixture, and parent-trace
 *   normalization mints/reuses one stable UUID per requestId.
 * @architectural-layer Flows
 * @related-files [packages/flow/src/flow_runner.ts, packages/flow/src/step_handlers/session_delegate_cycle_step_handler.ts, packages/flow/src/flow_trace_store.ts]
 */

import { assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { FlowInputSource, FlowOutputFormat, FlowStepExecutionMode, FlowStepType } from "@exaix/core";
import { FlowExecutionError, FlowRunner, type IAgentExecutor, type IFlowEventLogger } from "@exaix/flow";
import { FlowTraceStore, PlanContextResolver } from "@exaix/flow";
import type { IFlow } from "@exaix/schemas/flow.ts";
import type { IAgentExecutionResult } from "@exaix/execution";
import type { IGateConfig, IGateEvaluator, IGateResult } from "@exaix/core/types";
import { FlowGateAction } from "@exaix/core";
import type {
  ISessionDelegationCoordinator,
  ISessionDelegationOutcome,
  ISessionDelegationRequest,
} from "@exaix/session/session_delegation.ts";
import type { JSONValue } from "@exaix/core/types";

class NoOpAgentExecutor implements IAgentExecutor {
  run(): Promise<IAgentExecutionResult> {
    return Promise.resolve({ thought: "", content: "", raw: "" });
  }
}

class NoOpEventLogger implements IFlowEventLogger {
  log(_event: string, _payload: Record<string, JSONValue | undefined>): void {}
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

class RecordingCoordinator implements ISessionDelegationCoordinator {
  readonly requests: ISessionDelegationRequest[] = [];

  delegate(input: ISessionDelegationRequest): Promise<ISessionDelegationOutcome> {
    this.requests.push(input);
    return Promise.resolve({
      delegationTraceId: crypto.randomUUID(),
      parentTraceId: input.parentTraceId,
      parentStepId: input.parentStepId,
      sequence: input.sequence,
      status: "completed",
      decision: "changes_made",
      summary: `implemented step ${input.sequence}`,
      pathsTouched: ["packages/flow/src/example.ts"],
    });
  }
}

async function makeOneStepWorktree(slug: string): Promise<string> {
  const root = await Deno.makeTempDir({ prefix: "cycle-dispatch-" });
  const dir = join(root, ".exa", "PlanContext");
  await Deno.mkdir(dir, { recursive: true });
  await Deno.writeTextFile(
    join(dir, `${slug}.md`),
    "## Step 1\n\n**Actions:**\n- Do the thing\n\n```yaml\n# step-manifest\nstep: 1\ntitle: Do the thing\n```\n",
  );
  return root;
}

function makeCycleFlow(): IFlow {
  return {
    id: "cycle-flow",
    name: "Cycle Flow",
    description: "test",
    version: "1.0.0",
    steps: [
      {
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
            onFail: "halt" as never,
            maxRetries: 3,
            includeRequestCriteria: false,
          },
        },
      },
    ],
    output: { from: "next-steps", format: FlowOutputFormat.MARKDOWN },
    settings: { maxParallelism: 1, failFast: true, includeRequestCriteria: false },
  };
}

Deno.test("[integration] a real FlowRunner dispatch reaches SessionDelegateCycleStepHandler and coordinator for a one-step PlanContext fixture", async () => {
  const root = await makeOneStepWorktree("phase-174");
  try {
    const coordinator = new RecordingCoordinator();
    const runner = new FlowRunner({
      agentExecutor: new NoOpAgentExecutor(),
      eventLogger: new NoOpEventLogger(),
      gateEvaluator: new AlwaysPassGateEvaluator(),
      sessionDelegationCoordinator: coordinator,
      planContextResolver: new PlanContextResolver(),
    });

    const traceId = crypto.randomUUID();
    const result = await runner.execute(makeCycleFlow(), {
      userPrompt: "run the cycle",
      traceId,
      requestId: "req-cycle-1",
      executionRoot: root,
      planContextRef: ".exa/PlanContext/phase-174.md",
    });

    assertEquals(result.success, true);
    assertEquals(coordinator.requests.length, 1);
    assertEquals(coordinator.requests[0].parentTraceId, traceId);
    assertEquals(coordinator.requests[0].sequence, 1);
    assertEquals(coordinator.requests[0].worktreePath, root);
    assertEquals(coordinator.requests[0].artifactRef, ".exa/PlanContext/phase-174.md");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("[restart] omitted traceId normalizes to one stable parent trace for the same requestId, and a second dispatch replays idempotently", async () => {
  const root = await makeOneStepWorktree("phase-174-restart");
  const traceDir = await Deno.makeTempDir({ prefix: "flow-trace-store-restart-" });
  try {
    const coordinator = new RecordingCoordinator();
    const flowTraceStore = new FlowTraceStore(traceDir);
    const runner = new FlowRunner({
      agentExecutor: new NoOpAgentExecutor(),
      eventLogger: new NoOpEventLogger(),
      gateEvaluator: new AlwaysPassGateEvaluator(),
      sessionDelegationCoordinator: coordinator,
      planContextResolver: new PlanContextResolver(),
      flowTraceStore,
    });

    for (let i = 0; i < 2; i++) {
      await runner.execute(makeCycleFlow(), {
        userPrompt: "run the cycle",
        requestId: "req-cycle-restart",
        executionRoot: root,
        planContextRef: ".exa/PlanContext/phase-174-restart.md",
      });
    }

    // The durable checkpoint makes the second dispatch for the same parent trace an
    // idempotent replay, not a second full run — "accepted work is not executed twice".
    assertEquals(coordinator.requests.length, 1, "a completed checkpoint replays without relaunching");
    assertEquals(coordinator.requests[0].parentTraceId, await flowTraceStore.getOrCreate("req-cycle-restart"));
  } finally {
    await Deno.remove(root, { recursive: true });
    await Deno.remove(traceDir, { recursive: true });
  }
});

Deno.test("[restart] a cycle request with neither traceId nor requestId fails before dispatch", async () => {
  const coordinator = new RecordingCoordinator();
  const runner = new FlowRunner({
    agentExecutor: new NoOpAgentExecutor(),
    eventLogger: new NoOpEventLogger(),
    gateEvaluator: new AlwaysPassGateEvaluator(),
    sessionDelegationCoordinator: coordinator,
    planContextResolver: new PlanContextResolver(),
  });

  await assertRejects(
    () =>
      runner.execute(makeCycleFlow(), {
        userPrompt: "run the cycle",
        executionRoot: "/tmp/does-not-matter",
        planContextRef: ".exa/PlanContext/phase-174.md",
      }),
    FlowExecutionError,
  );
  assertEquals(coordinator.requests.length, 0, "the coordinator must never be invoked without a stable trace");
});

// Disabled/misconfigured session_delegate: main.ts only constructs a
// SessionDelegationCoordinator when enabled=true AND gates includes code_changes — both
// misconfigurations leave FlowRunner without one, so it never registers the step handler.

Deno.test("[security] session_delegate.enabled=false fails a session_delegate_cycle request before any launch", async () => {
  // Mirrors the exact FlowRunner state main.ts produces when `session_delegate.enabled` is
  // false: `sessionDelegationCoordinator`/`planContextResolver` both stay undefined.
  const runner = new FlowRunner({
    agentExecutor: new NoOpAgentExecutor(),
    eventLogger: new NoOpEventLogger(),
    gateEvaluator: new AlwaysPassGateEvaluator(),
  });

  await assertRejects(
    () =>
      runner.execute(makeCycleFlow(), {
        userPrompt: "run the cycle",
        traceId: crypto.randomUUID(),
        requestId: "req-cycle-disabled",
        executionRoot: "/tmp/does-not-matter",
        planContextRef: ".exa/PlanContext/phase-174.md",
      }),
    FlowExecutionError,
  );
});

Deno.test("[security] session_delegate.gates omitting code_changes fails a session_delegate_cycle request before any launch", async () => {
  // Mirrors the FlowRunner state main.ts produces when gates omits code_changes: both
  // coordinator fields stay undefined — the same fail-closed state as the disabled case
  // above, reached via a different config path.
  const runner = new FlowRunner({
    agentExecutor: new NoOpAgentExecutor(),
    eventLogger: new NoOpEventLogger(),
    gateEvaluator: new AlwaysPassGateEvaluator(),
  });

  await assertRejects(
    () =>
      runner.execute(makeCycleFlow(), {
        userPrompt: "run the cycle",
        traceId: crypto.randomUUID(),
        requestId: "req-cycle-no-code-changes-gate",
        executionRoot: "/tmp/does-not-matter",
        planContextRef: ".exa/PlanContext/phase-174.md",
      }),
    FlowExecutionError,
  );
});
