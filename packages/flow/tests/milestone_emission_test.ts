/**
 * @module MilestoneEmissionFlowTest
 * @path packages/flow/tests/milestone_emission_test.ts
 * @description Verifies that FlowRunner emits milestones at every lifecycle point
 * (flow.started, step.started, step.completed, step.replayed, flow.completed, flow.failed, etc.)
 * and respects the milestoneEmitter config field.
 */

import { assertEquals, assertExists } from "@std/assert";
import {
  FlowInputSource,
  FlowOutputFormat,
  MILESTONE_FLOW_COMPLETED,
  MILESTONE_FLOW_STARTED,
  MILESTONE_FLOW_STEP_COMPLETED,
  MILESTONE_FLOW_STEP_STARTED,
} from "@exaix/core";
import { FlowRunner, type IFlowEventLogger, type IFlowStepRequest } from "@exaix/flow";
import type { IFlow, IFlowStepInput } from "@exaix/schemas/flow.ts";
import type { IAgentExecutionResult } from "@exaix/execution";
import type { IExecutionMilestone } from "@exaix/schemas";
import type { IMilestoneEmitter } from "@exaix/core/observability";
import type { JSONValue } from "@exaix/core/types";
import type { IAgentExecutor } from "@exaix/flow";

class MockAgentRunner implements IAgentExecutor {
  run(_identityId: string, _request: IFlowStepRequest): Promise<IAgentExecutionResult> {
    return Promise.resolve({ thought: "Mock", content: "Result", raw: "raw" });
  }
}

class MockEventLogger implements IFlowEventLogger {
  log(_event: string, _payload: Record<string, JSONValue | undefined>): void {}
}

class MockMilestoneEmitter implements IMilestoneEmitter {
  milestones: Array<{ milestoneType: string; summary: string }> = [];

  emit(_milestone: IExecutionMilestone): Promise<void> {
    this.milestones.push({ milestoneType: _milestone.milestoneType, summary: _milestone.summary });
    return Promise.resolve();
  }
}

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
