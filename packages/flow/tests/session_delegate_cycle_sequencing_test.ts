/**
 * @module SessionDelegateCycleSequencingTest
 * @path packages/flow/tests/session_delegate_cycle_sequencing_test.ts
 * @description Phase 174 Step 3 unit/negative/security tests for
 *   SessionDelegateCycleStepHandler: strict non-overlapping sequential dispatch, no
 *   promise for step N+1 before N's review resolves, every halt class stopping before
 *   the next launch, and plan byte/step-count ceilings failing before the first launch.
 * @architectural-layer Flows
 * @related-files [packages/flow/src/step_handlers/session_delegate_cycle_step_handler.ts]
 */

import { assertEquals, assertRejects } from "@std/assert";
import {
  DEFAULT_SESSION_DELEGATE_CYCLE_MAX_PLAN_BYTES,
  DEFAULT_SESSION_DELEGATE_CYCLE_MAX_STEPS,
  FlowGateAction,
  FlowInputSource,
  FlowStepExecutionMode,
  FlowStepType,
} from "@exaix/core";
import type { IGateConfig, IGateEvaluator, IGateResult } from "@exaix/core/types";
import type { IFlowEventLogger, IFlowEventPayload } from "@exaix/flow";
import type { IStepExecutionContext } from "../src/step_handlers/step_handler.ts";
import { SessionDelegateCycleStepHandler } from "../src/step_handlers/session_delegate_cycle_step_handler.ts";
import type { IPlanContextResolver } from "../src/plan_context_resolver.ts";
import type {
  ISessionDelegationCoordinator,
  ISessionDelegationOutcome,
  ISessionDelegationRequest,
} from "@exaix/session/session_delegation.ts";
import { createInMemorySessionDelegateCycleClaimStore } from "@exaix/session/session_delegate_cycle_claim_store.ts";
import { createInMemorySessionDelegateCycleStore } from "@exaix/session/session_delegate_cycle_store.ts";

function stepHeading(n: number): string {
  return `## Step ${n}\n\n**Actions:**\n- do ${n}\n\n\`\`\`yaml\n# step-manifest\nstep: ${n}\ntitle: Step ${n}\n\`\`\`\n`;
}

function nStepPlan(n: number): string {
  return Array.from({ length: n }, (_, i) => stepHeading(i + 1)).join("\n");
}

class FakeResolver implements IPlanContextResolver {
  constructor(private readonly content: string) {}
  resolve(): Promise<{ absolutePath: string; content: string }> {
    return Promise.resolve({ absolutePath: "/fake/plan.md", content: this.content });
  }
}

class NoOpFlowEventLogger implements IFlowEventLogger {
  log<TEvent extends string>(_event: TEvent, _payload: IFlowEventPayload<TEvent>): void {}
}

function completedOutcome(sequence: number, pathsTouched: string[] = ["x.ts"]): ISessionDelegationOutcome {
  return {
    delegationTraceId: crypto.randomUUID(),
    parentTraceId: crypto.randomUUID(),
    parentStepId: "next-steps",
    sequence,
    status: "completed",
    decision: "changes_made",
    summary: `implemented step ${sequence}`,
    pathsTouched,
  };
}

class RecordingCoordinator implements ISessionDelegationCoordinator {
  readonly calls: Array<{ sequence: number; startedAt: number; endedAt: number }> = [];
  constructor(
    private readonly outcomeFor: (sequence: number) => ISessionDelegationOutcome,
    private readonly delayMsFor: (sequence: number) => number = () => 0,
  ) {}

  async delegate(input: ISessionDelegationRequest): Promise<ISessionDelegationOutcome> {
    const startedAt = performance.now();
    const delay = this.delayMsFor(input.sequence);
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
    const outcome = this.outcomeFor(input.sequence);
    this.calls.push({ sequence: input.sequence, startedAt, endedAt: performance.now() });
    return outcome;
  }
}

class AlwaysPassGateEvaluator implements IGateEvaluator {
  evaluate(): Promise<IGateResult> {
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

/** A gate evaluator whose promise for a given call index only resolves when told to. */
class ControllableGateEvaluator implements IGateEvaluator {
  private readonly pendingResolvers: Array<(result: IGateResult) => void> = [];
  callCount = 0;

  evaluate(_config: IGateConfig): Promise<IGateResult> {
    this.callCount++;
    return new Promise((resolve) => {
      this.pendingResolvers.push(resolve);
    });
  }

  resolveNext(passed = true): void {
    const resolve = this.pendingResolvers.shift();
    if (!resolve) throw new Error("no pending gate evaluation to resolve");
    resolve({
      passed,
      score: passed ? 1 : 0,
      evaluation: { score: passed ? 1 : 0, passed, feedback: "ok", criteriaScores: {} } as never,
      attempts: 1,
      action: passed ? FlowGateAction.PASSED : FlowGateAction.HALTED,
      evaluationDurationMs: 0,
    });
  }
}

function makeCtx(): IStepExecutionContext {
  return {
    stepType: FlowStepType.SESSION_DELEGATE_CYCLE,
    step: {
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
    } as IStepExecutionContext["step"],
    flow: { id: "cycle-flow" },
    request: {
      userPrompt: "run",
      traceId: crypto.randomUUID(),
      requestId: "req-1",
      executionRoot: "/fake/root",
      planContextRef: ".exa/PlanContext/phase-x.md",
    },
    stepRequest: { userPrompt: "run", context: {} },
    flowRunId: "flow-run-1",
    startedAt: new Date(),
    flowLogBase: { flowId: "cycle-flow" },
  } as IStepExecutionContext;
}

// Sequencing

Deno.test("[unit] a three-step plan produces exactly three non-overlapping coordinator calls in order", async () => {
  const coordinator = new RecordingCoordinator(
    (sequence) => completedOutcome(sequence),
    (sequence) => (sequence === 1 ? 15 : 0),
  );
  const handler = new SessionDelegateCycleStepHandler({
    coordinator,
    planContextResolver: new FakeResolver(nStepPlan(3)),
    gateEvaluator: new AlwaysPassGateEvaluator(),
    eventLogger: new NoOpFlowEventLogger(),
    claimStore: createInMemorySessionDelegateCycleClaimStore(),
    cycleStore: createInMemorySessionDelegateCycleStore(),
  });

  await handler.execute(makeCtx());

  assertEquals(coordinator.calls.map((c) => c.sequence), [1, 2, 3]);
  for (let i = 1; i < coordinator.calls.length; i++) {
    assertEquals(
      coordinator.calls[i].startedAt >= coordinator.calls[i - 1].endedAt,
      true,
      `call ${i} must not start before call ${i - 1} ended`,
    );
  }
});

Deno.test("[unit] step N+1 is not invoked until step N's review promise resolves passed", async () => {
  const coordinator = new RecordingCoordinator((sequence) => completedOutcome(sequence));
  const gateEvaluator = new ControllableGateEvaluator();
  const handler = new SessionDelegateCycleStepHandler({
    coordinator,
    planContextResolver: new FakeResolver(nStepPlan(2)),
    gateEvaluator,
    eventLogger: new NoOpFlowEventLogger(),
    claimStore: createInMemorySessionDelegateCycleClaimStore(),
    cycleStore: createInMemorySessionDelegateCycleStore(),
  });

  const resultPromise = handler.execute(makeCtx());

  await new Promise((resolve) => setTimeout(resolve, 0));
  assertEquals(coordinator.calls.length, 1, "only step 1 may have been delegated before its review resolves");
  assertEquals(gateEvaluator.callCount, 1);

  gateEvaluator.resolveNext(true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assertEquals(coordinator.calls.length, 2, "step 2 dispatches only after step 1's review passes");

  gateEvaluator.resolveNext(true);
  await resultPromise;
});

// Negative: every halt class stops before N+1

async function assertHaltsBeforeNextStep(
  outcomeForStepOne: ISessionDelegationOutcome,
  gateEvaluator: IGateEvaluator = new AlwaysPassGateEvaluator(),
): Promise<void> {
  const coordinator = new RecordingCoordinator((sequence) => sequence === 1 ? outcomeForStepOne : completedOutcome(2));
  const handler = new SessionDelegateCycleStepHandler({
    coordinator,
    planContextResolver: new FakeResolver(nStepPlan(2)),
    gateEvaluator,
    eventLogger: new NoOpFlowEventLogger(),
    claimStore: createInMemorySessionDelegateCycleClaimStore(),
    cycleStore: createInMemorySessionDelegateCycleStore(),
  });

  await assertRejects(() => handler.execute(makeCtx()));
  assertEquals(coordinator.calls.length, 1, "step 2 must never be attempted after step 1 halts");
}

Deno.test("[negative] an abandoned outcome halts before step 2", async () => {
  await assertHaltsBeforeNextStep({ ...completedOutcome(1), status: "abandoned", decision: "abandoned" });
});

Deno.test("[negative] a rejected outcome halts before step 2", async () => {
  await assertHaltsBeforeNextStep({ ...completedOutcome(1), status: "rejected", rejection: "scope_violation" });
});

Deno.test("[negative] an empty-pathsTouched outcome halts before step 2", async () => {
  await assertHaltsBeforeNextStep(completedOutcome(1, []));
});

Deno.test("[negative] a failed-review outcome halts before step 2", async () => {
  const gateEvaluator: IGateEvaluator = {
    evaluate: () =>
      Promise.resolve({
        passed: false,
        score: 0.1,
        evaluation: { score: 0.1, passed: false, feedback: "insufficient", criteriaScores: {} } as never,
        attempts: 1,
        action: FlowGateAction.HALTED,
        evaluationDurationMs: 0,
      }),
  };
  await assertHaltsBeforeNextStep(completedOutcome(1), gateEvaluator);
});

// Security: plan ceilings fail before the first launch

Deno.test("[security] an oversized plan fails before the first launch", async () => {
  const coordinator = new RecordingCoordinator((sequence) => completedOutcome(sequence));
  const oversizedContent = "x".repeat(DEFAULT_SESSION_DELEGATE_CYCLE_MAX_PLAN_BYTES + 1);
  const handler = new SessionDelegateCycleStepHandler({
    coordinator,
    planContextResolver: new FakeResolver(oversizedContent),
    gateEvaluator: new AlwaysPassGateEvaluator(),
    eventLogger: new NoOpFlowEventLogger(),
    claimStore: createInMemorySessionDelegateCycleClaimStore(),
    cycleStore: createInMemorySessionDelegateCycleStore(),
  });

  await assertRejects(() => handler.execute(makeCtx()));
  assertEquals(coordinator.calls.length, 0, "no delegation may launch for an oversized plan");
});

Deno.test("[security] a plan exceeding the step-count ceiling fails before the first launch", async () => {
  const coordinator = new RecordingCoordinator((sequence) => completedOutcome(sequence));
  const tooManySteps = nStepPlan(DEFAULT_SESSION_DELEGATE_CYCLE_MAX_STEPS + 1);
  const handler = new SessionDelegateCycleStepHandler({
    coordinator,
    planContextResolver: new FakeResolver(tooManySteps),
    gateEvaluator: new AlwaysPassGateEvaluator(),
    eventLogger: new NoOpFlowEventLogger(),
    claimStore: createInMemorySessionDelegateCycleClaimStore(),
    cycleStore: createInMemorySessionDelegateCycleStore(),
  });

  await assertRejects(() => handler.execute(makeCtx()));
  assertEquals(coordinator.calls.length, 0, "no delegation may launch for an excessive step count");
});
