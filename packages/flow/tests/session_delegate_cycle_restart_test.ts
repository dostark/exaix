/**
 * @module SessionDelegateCycleRestartTest
 * @path packages/flow/tests/session_delegate_cycle_restart_test.ts
 * @description Phase 174 Step 4 restart/race/security/negative tests for
 *   SessionDelegateCycleStepHandler: resume from a persisted checkpoint at each of the
 *   four claim/spawn/return/review crash points without a duplicate launch, duplicate
 *   handler entry for the same idempotency tuple launching at most one delegate, a
 *   changed plan digest or forged checkpoint identity failing closed, and cancellation/
 *   expiry/rejection persisting a terminal, non-advancing checkpoint.
 * @architectural-layer Flows
 * @related-files [packages/flow/src/step_handlers/session_delegate_cycle_step_handler.ts, packages/session/src/session_delegate_cycle_claim_store.ts, packages/session/src/session_delegate_cycle_store.ts]
 */

import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import type { JSONValue } from "@exaix/core";
import { FlowInputSource, FlowStepExecutionMode, FlowStepType } from "@exaix/core";
import type { IGateEvaluator, IGateResult } from "@exaix/core/types";
import { FlowGateAction } from "@exaix/core";
import type { IFlowEventLogger, IFlowEventPayload } from "@exaix/flow";
import type { IStepExecutionContext } from "../src/step_handlers/step_handler.ts";
import { SessionDelegateCycleStepHandler } from "../src/step_handlers/session_delegate_cycle_step_handler.ts";
import type { IPlanContextResolver } from "../src/plan_context_resolver.ts";
import { computePlanDigest } from "../src/plan_digest.ts";
import type {
  ISessionDelegationCoordinator,
  ISessionDelegationOutcome,
  ISessionDelegationRequest,
} from "@exaix/session/session_delegation.ts";
import {
  createInMemorySessionDelegateCycleClaimStore,
  type ISessionDelegateCycleClaimStore,
} from "@exaix/session/session_delegate_cycle_claim_store.ts";
import {
  createInMemorySessionDelegateCycleStore,
  type ISessionDelegateCycleCheckpoint,
  type ISessionDelegateCycleStore,
} from "@exaix/session/session_delegate_cycle_store.ts";

const PARENT_STEP_ID = "next-steps";
const FLOW_STEP_ID = "next-steps";

function onePlan(): string {
  return "## Step 1\n\n**Actions:**\n- do 1\n\n```yaml\n# step-manifest\nstep: 1\ntitle: Step 1\n```\n";
}

class FakeResolver implements IPlanContextResolver {
  constructor(private readonly content: string) {}
  resolve(): Promise<{ absolutePath: string; content: string }> {
    return Promise.resolve({ absolutePath: "/fake/plan.md", content: this.content });
  }
}

class NoOpFlowEventLogger implements IFlowEventLogger {
  readonly events: Array<{ event: string; payload: Record<string, JSONValue | undefined> }> = [];
  log<TEvent extends string>(event: TEvent, payload: IFlowEventPayload<TEvent>): void {
    this.events.push({ event, payload });
  }
}

class AlwaysPassGateEvaluator implements IGateEvaluator {
  callCount = 0;
  evaluate(): Promise<IGateResult> {
    this.callCount++;
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
  readonly calls: ISessionDelegationRequest[] = [];
  constructor(private readonly outcomeFor: (input: ISessionDelegationRequest) => ISessionDelegationOutcome) {}
  delegate(input: ISessionDelegationRequest): Promise<ISessionDelegationOutcome> {
    this.calls.push(input);
    return Promise.resolve(this.outcomeFor(input));
  }
}

function completedOutcome(input: ISessionDelegationRequest): ISessionDelegationOutcome {
  return {
    delegationTraceId: input.delegationTraceId ?? crypto.randomUUID(),
    parentTraceId: input.parentTraceId,
    parentStepId: input.parentStepId,
    sequence: input.sequence,
    status: "completed",
    decision: "changes_made",
    summary: "did the thing",
    pathsTouched: ["a.ts"],
  };
}

function makeCtx(traceId: string, flowRunId = "flow-run-1"): IStepExecutionContext {
  return {
    stepType: FlowStepType.SESSION_DELEGATE_CYCLE,
    step: {
      id: FLOW_STEP_ID,
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
    } as IStepExecutionContext["step"],
    flow: { id: "cycle-flow" },
    request: {
      userPrompt: "run",
      traceId,
      requestId: "req-1",
      executionRoot: "/fake/root",
      planContextRef: ".exa/PlanContext/phase-x.md",
    },
    stepRequest: { userPrompt: "run", context: {} },
    flowRunId,
    startedAt: new Date(),
    flowLogBase: { flowId: "cycle-flow" },
  } as IStepExecutionContext;
}

function makeHandler(opts: {
  coordinator: ISessionDelegationCoordinator;
  claimStore: ISessionDelegateCycleClaimStore;
  cycleStore: ISessionDelegateCycleStore;
  gateEvaluator?: IGateEvaluator;
  eventLogger?: IFlowEventLogger;
  content?: string;
}): SessionDelegateCycleStepHandler {
  return new SessionDelegateCycleStepHandler({
    coordinator: opts.coordinator,
    planContextResolver: new FakeResolver(opts.content ?? onePlan()),
    gateEvaluator: opts.gateEvaluator ?? new AlwaysPassGateEvaluator(),
    eventLogger: opts.eventLogger ?? new NoOpFlowEventLogger(),
    claimStore: opts.claimStore,
    cycleStore: opts.cycleStore,
    sleep: () => new Promise((resolve) => setTimeout(resolve, 1)),
    pollIntervalMs: 1,
    maxPollAttempts: 20,
  });
}

// Restart integration: four crash points

Deno.test("[restart integration] crash before claim recovers with a single fresh launch", async () => {
  const traceId = crypto.randomUUID();
  const coordinator = new RecordingCoordinator(completedOutcome);
  const claimStore = createInMemorySessionDelegateCycleClaimStore();
  const cycleStore = createInMemorySessionDelegateCycleStore();
  const handler = makeHandler({ coordinator, claimStore, cycleStore });

  await handler.execute(makeCtx(traceId));

  assertEquals(coordinator.calls.length, 1);
  const checkpoint = await cycleStore.load(traceId, FLOW_STEP_ID);
  assertEquals(checkpoint?.status, "completed");
});

Deno.test("[restart integration] crash after claim/before spawn reclaims and launches exactly once", async () => {
  const traceId = crypto.randomUUID();
  const planDigest = await computePlanDigest(onePlan());
  const claimStore = createInMemorySessionDelegateCycleClaimStore();
  const cycleStore = createInMemorySessionDelegateCycleStore();
  const staleTrace = crypto.randomUUID();
  await claimStore.acquire(
    { parentTraceId: traceId, parentStepId: PARENT_STEP_ID, sequence: 1, planDigest },
    staleTrace,
  );
  const checkpoint: ISessionDelegateCycleCheckpoint = {
    parentTraceId: traceId,
    lastFlowRunId: "crashed-flow-run",
    flowStepId: FLOW_STEP_ID,
    planDigest,
    revision: 1,
    nextSequence: 1,
    completedSteps: [],
    inFlight: { idempotencyKey: "k", sequence: 1, delegationTraceId: staleTrace, state: "claimed" },
    status: "running",
    updatedAt: new Date().toISOString(),
  };
  await cycleStore.save(checkpoint);
  const coordinator = new RecordingCoordinator(completedOutcome);
  const handler = makeHandler({ coordinator, claimStore, cycleStore });

  await handler.execute(makeCtx(traceId, "resumed-flow-run"));

  assertEquals(coordinator.calls.length, 1, "the resumer launches exactly once");
  assertEquals(
    coordinator.calls[0].delegationTraceId === staleTrace,
    false,
    "a pre-launch claim is reclaimed with a fresh trace, never the stale one",
  );
});

Deno.test("[restart integration] crash after spawn/before return awaits the original launch without relaunching", async () => {
  const traceId = crypto.randomUUID();
  const planDigest = await computePlanDigest(onePlan());
  const claimStore = createInMemorySessionDelegateCycleClaimStore();
  const cycleStore = createInMemorySessionDelegateCycleStore();
  const key = { parentTraceId: traceId, parentStepId: PARENT_STEP_ID, sequence: 1, planDigest };
  const launchedTrace = crypto.randomUUID();
  await claimStore.acquire(key, launchedTrace);
  await claimStore.transition(key, "launched");
  const checkpoint: ISessionDelegateCycleCheckpoint = {
    parentTraceId: traceId,
    lastFlowRunId: "crashed-flow-run",
    flowStepId: FLOW_STEP_ID,
    planDigest,
    revision: 2,
    nextSequence: 1,
    completedSteps: [],
    inFlight: { idempotencyKey: "k", sequence: 1, delegationTraceId: launchedTrace, state: "launched" },
    status: "running",
    updatedAt: new Date().toISOString(),
  };
  await cycleStore.save(checkpoint);
  const coordinator = new RecordingCoordinator(completedOutcome);
  const handler = makeHandler({ coordinator, claimStore, cycleStore });

  const resultPromise = handler.execute(makeCtx(traceId, "resumed-flow-run"));
  // Simulate the original delegation's return finally landing out-of-band.
  await new Promise((resolve) => setTimeout(resolve, 5));
  await claimStore.transition(key, "returned", {
    outcome: {
      delegationTraceId: launchedTrace,
      parentTraceId: traceId,
      parentStepId: PARENT_STEP_ID,
      sequence: 1,
      status: "completed",
      decision: "changes_made",
      summary: "finished after all",
      pathsTouched: ["b.ts"],
    },
  });

  await resultPromise;

  assertEquals(coordinator.calls.length, 0, "a launched claim is awaited, never relaunched");
  const finalClaim = await claimStore.get(key);
  assertEquals(finalClaim?.state, "reviewed");
});

Deno.test("[restart integration] crash after return/before review reviews the stored outcome without relaunching", async () => {
  const traceId = crypto.randomUUID();
  const planDigest = await computePlanDigest(onePlan());
  const claimStore = createInMemorySessionDelegateCycleClaimStore();
  const cycleStore = createInMemorySessionDelegateCycleStore();
  const key = { parentTraceId: traceId, parentStepId: PARENT_STEP_ID, sequence: 1, planDigest };
  const returnedTrace = crypto.randomUUID();
  await claimStore.acquire(key, returnedTrace);
  await claimStore.transition(key, "launched");
  await claimStore.transition(key, "returned", {
    outcome: {
      delegationTraceId: returnedTrace,
      parentTraceId: traceId,
      parentStepId: PARENT_STEP_ID,
      sequence: 1,
      status: "completed",
      decision: "changes_made",
      summary: "already returned before the crash",
      pathsTouched: ["c.ts"],
    },
  });
  const checkpoint: ISessionDelegateCycleCheckpoint = {
    parentTraceId: traceId,
    lastFlowRunId: "crashed-flow-run",
    flowStepId: FLOW_STEP_ID,
    planDigest,
    revision: 3,
    nextSequence: 1,
    completedSteps: [],
    inFlight: { idempotencyKey: "k", sequence: 1, delegationTraceId: returnedTrace, state: "returned" },
    status: "running",
    updatedAt: new Date().toISOString(),
  };
  await cycleStore.save(checkpoint);
  const coordinator = new RecordingCoordinator(completedOutcome);
  const gateEvaluator = new AlwaysPassGateEvaluator();
  const handler = makeHandler({ coordinator, claimStore, cycleStore, gateEvaluator });

  await handler.execute(makeCtx(traceId, "resumed-flow-run"));

  assertEquals(coordinator.calls.length, 0, "a returned claim is reviewed, never relaunched");
  assertEquals(gateEvaluator.callCount, 1);
  const finalCheckpoint = await cycleStore.load(traceId, FLOW_STEP_ID);
  assertEquals(finalCheckpoint?.status, "completed");
});

// Race: duplicate handler entry

Deno.test("[race] duplicate handler entry for the same idempotency tuple launches at most one delegate", async () => {
  const traceId = crypto.randomUUID();
  const claimStore = createInMemorySessionDelegateCycleClaimStore();
  const cycleStoreA = createInMemorySessionDelegateCycleStore();
  const cycleStoreB = createInMemorySessionDelegateCycleStore();
  const coordinator = new RecordingCoordinator(completedOutcome);
  const gateEvaluator = new AlwaysPassGateEvaluator();
  const handlerA = makeHandler({ coordinator, claimStore, cycleStore: cycleStoreA, gateEvaluator });
  const handlerB = makeHandler({ coordinator, claimStore, cycleStore: cycleStoreB, gateEvaluator });

  const [resultA, resultB] = await Promise.all([
    handlerA.execute(makeCtx(traceId, "flow-run-a")),
    handlerB.execute(makeCtx(traceId, "flow-run-b")),
  ]);

  assertEquals(coordinator.calls.length, 1, "only one of the two concurrent entries may launch");
  assertEquals(gateEvaluator.callCount, 1, "the review itself must not be duplicated either");
  assertEquals(typeof resultA.raw, "string");
  assertEquals(typeof resultB.raw, "string");
});

// Security: forged/changed checkpoint identity

Deno.test("[security] a changed plan digest cannot reuse the persisted checkpoint", async () => {
  const traceId = crypto.randomUUID();
  const staleDigest = await computePlanDigest("stale plan content, no longer current");
  const claimStore = createInMemorySessionDelegateCycleClaimStore();
  const cycleStore = createInMemorySessionDelegateCycleStore();
  await cycleStore.save({
    parentTraceId: traceId,
    lastFlowRunId: "flow-run-old",
    flowStepId: FLOW_STEP_ID,
    planDigest: staleDigest,
    revision: 1,
    nextSequence: 1,
    completedSteps: [],
    status: "running",
    updatedAt: new Date().toISOString(),
  });
  const coordinator = new RecordingCoordinator(completedOutcome);
  const handler = makeHandler({ coordinator, claimStore, cycleStore });

  await assertRejects(
    () => handler.execute(makeCtx(traceId)),
    Error,
    "does not match this attempt",
  );

  assertEquals(coordinator.calls.length, 0, "no delegation may launch against a forged/changed checkpoint");
  const untouched = await cycleStore.load(traceId, FLOW_STEP_ID);
  assertEquals(untouched?.planDigest, staleDigest, "the mismatched checkpoint is left untouched as evidence");
  assertEquals(untouched?.status, "running", "a checkpoint_mismatch halt must not overwrite the existing evidence");
});

Deno.test("[security] cycle lifecycle events carry no prompt text or absolute host paths", async () => {
  const traceId = crypto.randomUUID();
  const claimStore = createInMemorySessionDelegateCycleClaimStore();
  const cycleStore = createInMemorySessionDelegateCycleStore();
  const coordinator = new RecordingCoordinator(completedOutcome);
  const eventLogger = new NoOpFlowEventLogger();
  const handler = makeHandler({ coordinator, claimStore, cycleStore, eventLogger });

  await handler.execute(makeCtx(traceId));

  const serialized = JSON.stringify(eventLogger.events);
  assertEquals(serialized.includes("/fake/root"), false, "no absolute worktree path in any cycle event payload");
  assertEquals(serialized.includes("do 1"), false, "no plan section prose in any cycle event payload");
});

// Negative: cancellation/expiry/rejection persists failure, never advances

for (
  const status of ["cancelled", "expired", "rejected"] as const
) {
  Deno.test(`[negative] a ${status} outcome persists terminal failure and never advances nextSequence`, async () => {
    const traceId = crypto.randomUUID();
    const claimStore = createInMemorySessionDelegateCycleClaimStore();
    const cycleStore = createInMemorySessionDelegateCycleStore();
    const coordinator = new RecordingCoordinator((input) => ({
      ...completedOutcome(input),
      status,
      decision: undefined,
      pathsTouched: [],
    }));
    const handler = makeHandler({ coordinator, claimStore, cycleStore });

    await assertRejects(() => handler.execute(makeCtx(traceId)));

    const checkpoint = await cycleStore.load(traceId, FLOW_STEP_ID);
    assertEquals(checkpoint?.status, "failed");
    assertEquals(checkpoint?.nextSequence, 1, "a failed step must never advance nextSequence");
    assertEquals(checkpoint?.inFlight, undefined);
    assertStringIncludes(checkpoint?.failure ?? "", "non_completed_status");
  });
}
