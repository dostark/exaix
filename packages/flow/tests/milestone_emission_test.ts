/**
 * @module MilestoneEmissionFlowTest
 * @path packages/flow/tests/milestone_emission_test.ts
 * @description Verifies that FlowRunner emits milestones at every lifecycle point
 * (flow.started, step.started, step.completed, step.replayed, flow.completed, flow.failed, etc.)
 * and respects the milestoneEmitter config field.
 */

import { assertEquals, assertExists, assertStringIncludes } from "@std/assert";
import {
  FlowGateAction,
  FlowGateOnFail,
  FlowInputSource,
  FlowOutputFormat,
  FlowStepType,
  MILESTONE_APPROVAL_GATE_ENTERED,
  MILESTONE_FLOW_COMPLETED,
  MILESTONE_FLOW_FAILED,
  MILESTONE_FLOW_STARTED,
  MILESTONE_FLOW_STEP_COMPLETED,
  MILESTONE_FLOW_STEP_REPLAYED,
  MILESTONE_FLOW_STEP_SKIPPED,
  MILESTONE_FLOW_STEP_STARTED,
  StepAttemptClass,
  StepSideEffectClass,
} from "@exaix/core";
import {
  DefaultStepReplayPolicy,
  FlowRunner,
  type IFlowEventLogger,
  type IFlowStepRequest,
  type IStepDurabilityStore,
  type IStepExecutionRecord,
  type IWaitStateService,
  WaitStateKindSchema,
  WaitStateStatusSchema,
} from "@exaix/flow";
import type { IFlow, IFlowStepInput } from "@exaix/schemas/flow.ts";
import type { IAgentExecutionResult } from "@exaix/execution";
import type { IExecutionMilestone } from "@exaix/schemas";
import type { IMilestoneEmitter } from "@exaix/core/observability";
import type { IGateConfig, IGateEvaluator, IGateResult, JSONValue } from "@exaix/core/types";
import type { IAgentExecutor } from "@exaix/flow";

class MockAgentRunner implements IAgentExecutor {
  run(_identityId: string, _request: IFlowStepRequest): Promise<IAgentExecutionResult> {
    return Promise.resolve({ thought: "Mock", content: "Result", raw: "raw" });
  }
}

class ThrowingAgentRunner implements IAgentExecutor {
  run(_identityId: string, _request: IFlowStepRequest): Promise<IAgentExecutionResult> {
    throw new Error("Simulated execution failure");
  }
}

class MockEventLogger implements IFlowEventLogger {
  log(_event: string, _payload: Record<string, JSONValue | undefined>): void {}
}

class MockMilestoneEmitter implements IMilestoneEmitter {
  milestones: IExecutionMilestone[] = [];

  emit(milestone: IExecutionMilestone): Promise<void> {
    this.milestones.push(milestone);
    return Promise.resolve();
  }

  countByType(type: string): number {
    return this.milestones.filter((m) => m.milestoneType === type).length;
  }
}

const mockEvaluator = {
  evaluate(_config: IGateConfig): Promise<IGateResult> {
    return Promise.resolve({
      passed: false,
      score: 0.2,
      evaluation: {
        overallScore: 0.2,
        criteriaScores: { gate: { name: "gate", score: 0.2, reasoning: "Not met", issues: [], passed: false } },
        pass: false,
        feedback: "Gate criteria not met",
        suggestions: [],
      },
      attempts: 1,
      action: FlowGateAction.HALTED,
      evaluationDurationMs: 5,
    } as IGateResult);
  },
} as IGateEvaluator;

function createMockWaitStateService(): IWaitStateService {
  return {
    create(
      _input: {
        traceId: string;
        kind: string;
        artifactPath: string;
        resumeToken: string;
        requestedBy?: string;
        deadlineAt?: string;
      },
    ) {
      const now = new Date().toISOString();
      return Promise.resolve({
        waitStateId: crypto.randomUUID(),
        traceId: _input.traceId,
        kind: WaitStateKindSchema.enum.plan_approval,
        status: WaitStateStatusSchema.enum.pending,
        artifactPath: _input.artifactPath,
        resumeToken: _input.resumeToken,
        requestedBy: _input.requestedBy ?? "",
        createdAt: now,
        updatedAt: now,
        metadata: {} as const,
      });
    },
    getById: () => Promise.resolve(null),
    getByToken: () => Promise.resolve(null),
    transition: () =>
      Promise.resolve({
        waitStateId: crypto.randomUUID(),
        traceId: "",
        kind: WaitStateKindSchema.enum.plan_approval,
        status: WaitStateStatusSchema.enum.fulfilled,
        artifactPath: "",
        resumeToken: "",
        requestedBy: "",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        metadata: {},
      }),
    listPending: () => Promise.resolve([]),
  };
}
const mockWaitStateService = createMockWaitStateService();

const mockDurabilityStore = {
  save(_record: IStepExecutionRecord): Promise<void> {
    return Promise.resolve();
  },
  findReplayCandidate(_query: {
    traceId: string;
    flowId: string;
    stepId: string;
    attemptClass: string;
    inputHash: string;
    toolPolicyHash?: string;
    portalScopeHash?: string;
  }): Promise<IStepExecutionRecord | null> {
    return Promise.resolve({
      recordId: crypto.randomUUID(),
      traceId: _query.traceId,
      flowId: _query.flowId,
      stepId: _query.stepId,
      idempotencyKey: {
        traceId: _query.traceId,
        flowId: _query.flowId,
        stepId: _query.stepId,
        attemptClass: StepAttemptClass.INITIAL,
        inputHash: _query.inputHash,
      },
      disposition: "executed" as const,
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      durationMs: 100,
      inputHash: _query.inputHash,
      sideEffectClass: StepSideEffectClass.LLM,
      replayEligible: true,
      summary: "Replayed result",
    } as IStepExecutionRecord);
  },
  invalidate(_recordId: string, _reason: string): Promise<void> {
    return Promise.resolve();
  },
} as IStepDurabilityStore;

const mockAgentRunner = new MockAgentRunner();

function createSimpleFlow(): IFlow {
  const steps: IFlowStepInput[] = [
    {
      id: "step1",
      name: "Step 1",
      identity: "agent1",
      dependsOn: [],
      input: { source: FlowInputSource.REQUEST, transform: "passthrough" },
    },
    {
      id: "step2",
      name: "Step 2",
      identity: "agent2",
      dependsOn: ["step1"],
      input: { source: FlowInputSource.STEP, stepId: "step1", transform: "passthrough" },
    },
  ];

  return {
    id: "test-flow",
    name: "Test Flow",
    description: "A test flow",
    version: "1.0.0",
    steps,
    output: { from: "step2", format: FlowOutputFormat.MARKDOWN },
    settings: { maxParallelism: 3, failFast: true },
  } as IFlow;
}

Deno.test("FlowRunner: emits flow.started milestone at beginning", async () => {
  const emitter = new MockMilestoneEmitter();
  const runner = new FlowRunner({
    agentExecutor: mockAgentRunner,
    eventLogger: new MockEventLogger(),
    milestoneEmitter: emitter,
  });
  await runner.execute(createSimpleFlow(), { userPrompt: "test" });

  const flowStarted = emitter.milestones.find((m) => m.milestoneType === MILESTONE_FLOW_STARTED);
  assertExists(flowStarted, "flow.started milestone should be emitted");
});

Deno.test("FlowRunner: emits flow.step.started for each step", async () => {
  const emitter = new MockMilestoneEmitter();
  const runner = new FlowRunner({
    agentExecutor: mockAgentRunner,
    eventLogger: new MockEventLogger(),
    milestoneEmitter: emitter,
  });
  await runner.execute(createSimpleFlow(), { userPrompt: "test" });

  const stepEvents = emitter.milestones.filter((m) => m.milestoneType === MILESTONE_FLOW_STEP_STARTED);
  assertEquals(stepEvents.length, 2, "should emit flow.step.started for 2 steps");
});

Deno.test("FlowRunner: emits flow.step.completed for each step", async () => {
  const emitter = new MockMilestoneEmitter();
  const runner = new FlowRunner({
    agentExecutor: mockAgentRunner,
    eventLogger: new MockEventLogger(),
    milestoneEmitter: emitter,
  });
  await runner.execute(createSimpleFlow(), { userPrompt: "test" });

  const stepCompleted = emitter.milestones.filter((m) => m.milestoneType === MILESTONE_FLOW_STEP_COMPLETED);
  assertEquals(stepCompleted.length, 2, "should emit flow.step.completed for 2 steps");
});

Deno.test("FlowRunner: emits flow.completed at end of successful flow", async () => {
  const emitter = new MockMilestoneEmitter();
  const runner = new FlowRunner({
    agentExecutor: mockAgentRunner,
    eventLogger: new MockEventLogger(),
    milestoneEmitter: emitter,
  });
  await runner.execute(createSimpleFlow(), { userPrompt: "test" });

  const flowCompleted = emitter.milestones.find((m) => m.milestoneType === MILESTONE_FLOW_COMPLETED);
  assertExists(flowCompleted, "flow.completed milestone should be emitted");
});

Deno.test("FlowRunner: emits milestones in correct semantic order", async () => {
  const emitter = new MockMilestoneEmitter();
  const runner = new FlowRunner({
    agentExecutor: mockAgentRunner,
    eventLogger: new MockEventLogger(),
    milestoneEmitter: emitter,
  });
  await runner.execute(createSimpleFlow(), { userPrompt: "test" });

  const types = emitter.milestones.map((m) => m.milestoneType);
  const step1Started = types.indexOf(MILESTONE_FLOW_STEP_STARTED);

  assertEquals(types[0], MILESTONE_FLOW_STARTED, "flow.started should be first");
  assertEquals(types[types.length - 1], MILESTONE_FLOW_COMPLETED, "flow.completed should be last");
  assertEquals(
    step1Started < types.lastIndexOf(MILESTONE_FLOW_STEP_COMPLETED),
    true,
    "step.started should precede step.completed",
  );
});

Deno.test("FlowRunner: emits milestones in correct order for 2-step flow", async () => {
  const emitter = new MockMilestoneEmitter();
  const runner = new FlowRunner({
    agentExecutor: mockAgentRunner,
    eventLogger: new MockEventLogger(),
    milestoneEmitter: emitter,
  });
  await runner.execute(createSimpleFlow(), { userPrompt: "test" });

  const types = emitter.milestones.map((m) => m.milestoneType);
  const step1Started = types.indexOf(MILESTONE_FLOW_STEP_STARTED);
  const step2Started = types.lastIndexOf(MILESTONE_FLOW_STEP_STARTED);
  const step1Completed = types.indexOf(MILESTONE_FLOW_STEP_COMPLETED);
  const step2Completed = types.lastIndexOf(MILESTONE_FLOW_STEP_COMPLETED);

  assertEquals(step1Started < step1Completed, true, "step1 started before completed");
  assertEquals(step1Completed < step2Started, true, "step1 completed before step2 started");
  assertEquals(types.indexOf(MILESTONE_FLOW_STARTED) < step1Started, true, "flow.started before any step");
  assertEquals(step2Completed < types.indexOf(MILESTONE_FLOW_COMPLETED), true, "step2 completed before flow.completed");
});

Deno.test("FlowRunner: does not emit milestones when emitter is undefined", async () => {
  const runner = new FlowRunner({ agentExecutor: mockAgentRunner, eventLogger: new MockEventLogger() });
  const result = await runner.execute(createSimpleFlow(), { userPrompt: "test" });
  assertEquals(result.success, true, "flow should succeed without milestone emitter");
});

Deno.test("FlowRunner: emits flow.step.skipped when step condition is false", async () => {
  const emitter = new MockMilestoneEmitter();
  const flow: IFlow = {
    id: "test-flow-skip",
    name: "Test Skip",
    description: "A flow with a skipped step",
    version: "1.0.0",
    steps: [
      {
        id: "step1",
        name: "Step 1",
        identity: "agent1",
        dependsOn: [],
        condition: "false",
        input: { source: FlowInputSource.REQUEST, transform: "passthrough" },
      } as IFlowStepInput,
    ],
    output: { from: "step1", format: FlowOutputFormat.MARKDOWN },
    settings: { maxParallelism: 3, failFast: true },
  } as IFlow;
  const runner = new FlowRunner({
    agentExecutor: mockAgentRunner,
    eventLogger: new MockEventLogger(),
    milestoneEmitter: emitter,
  });

  await runner.execute(flow, { userPrompt: "test" });

  const skipped = emitter.milestones.find((m) => m.milestoneType === MILESTONE_FLOW_STEP_SKIPPED);
  assertExists(skipped, "flow.step.skipped milestone should be emitted");
  assertStringIncludes(skipped.summary, "Step 1");
});

Deno.test("FlowRunner: emits flow.step.replayed when step result is reused", async () => {
  const emitter = new MockMilestoneEmitter();
  const runner = new FlowRunner({
    agentExecutor: mockAgentRunner,
    eventLogger: new MockEventLogger(),
    milestoneEmitter: emitter,
    stepDurabilityStore: mockDurabilityStore,
    stepReplayPolicy: new DefaultStepReplayPolicy(),
  });

  await runner.execute(createSimpleFlow(), { userPrompt: "test", traceId: crypto.randomUUID() });

  const replayed = emitter.milestones.find((m) => m.milestoneType === MILESTONE_FLOW_STEP_REPLAYED);
  assertExists(replayed, "flow.step.replayed milestone should be emitted when replay candidate exists");
});

Deno.test("FlowRunner: emits approval.gate.entered on gate failure with wait state", async () => {
  const emitter = new MockMilestoneEmitter();
  const flow: IFlow = {
    id: "test-flow-gate",
    name: "Test Gate",
    description: "A flow with an approval gate",
    version: "1.0.0",
    steps: [
      {
        id: "gate1",
        name: "Quality Gate",
        identity: "judge1",
        dependsOn: [],
        type: FlowStepType.GATE,
        evaluate: {
          identity: "judge1",
          criteria: ["clarity"],
          threshold: 0.7,
          onFail: FlowGateOnFail.HALT,
        },
        input: { source: FlowInputSource.REQUEST, transform: "passthrough" },
      } as IFlowStepInput,
    ],
    output: { from: "gate1", format: FlowOutputFormat.MARKDOWN },
    settings: { maxParallelism: 3, failFast: true },
  } as IFlow;
  const runner = new FlowRunner({
    agentExecutor: mockAgentRunner,
    eventLogger: new MockEventLogger(),
    milestoneEmitter: emitter,
    gateEvaluator: mockEvaluator,
    waitStateService: mockWaitStateService,
  });

  await runner.execute(flow, { userPrompt: "test", traceId: crypto.randomUUID() });

  const gateEntered = emitter.milestones.find((m) => m.milestoneType === MILESTONE_APPROVAL_GATE_ENTERED);
  assertExists(gateEntered, "approval.gate.entered milestone should be emitted");
  assertEquals(gateEntered.requiresAttention, true, "gate milestone should require attention");
});

Deno.test("FlowRunner: emits flow.failed when execution error occurs", async () => {
  const emitter = new MockMilestoneEmitter();
  const throwingRunner = new FlowRunner({
    agentExecutor: new ThrowingAgentRunner(),
    eventLogger: new MockEventLogger(),
    milestoneEmitter: emitter,
  });

  try {
    await throwingRunner.execute(createSimpleFlow(), { userPrompt: "test" });
  } catch {
    // Expected: flow throws after emitting failed milestone
  }

  const failed = emitter.milestones.find((m) => m.milestoneType === MILESTONE_FLOW_FAILED);
  assertExists(failed, "flow.failed milestone should be emitted on execution error");
});
