/**
 * @module MilestoneEmissionAgentRunnerTest
 * @path packages/execution/tests/milestone_emission_agent_runner_test.ts
 * @description Verifies that AgentRunner emits milestones (llm.call.started, llm.call.completed)
 * and respects the milestoneEmitter config field.
 */

import { assertEquals, assertExists } from "@std/assert";
import { MILESTONE_LLM_CALL_COMPLETED, MILESTONE_LLM_CALL_STARTED } from "@exaix/core";
import { AgentRunner, type IBlueprint, type IParsedRequest } from "@exaix/execution";
import { MockProvider } from "@exaix/ai/providers.ts";
import type { IExecutionMilestone } from "@exaix/schemas";
import type { IMilestoneEmitter } from "@exaix/core/observability";

class MockMilestoneEmitter implements IMilestoneEmitter {
  milestones: IExecutionMilestone[] = [];

  emit(milestone: IExecutionMilestone): Promise<void> {
    this.milestones.push(milestone);
    return Promise.resolve();
  }
}

const sampleBlueprint: IBlueprint = {
  systemPrompt: "You are a helpful assistant.",
};

const sampleRequest: IParsedRequest = {
  userPrompt: "Write a hello world function",
  context: {},
};

const wellFormedResponse = `<thought>Simple</thought>
<content>console.log("Hello");</content>`;

Deno.test("AgentRunner: emits llm.call.started before LLM call", async () => {
  const emitter = new MockMilestoneEmitter();
  const mockProvider = new MockProvider(wellFormedResponse);
  const runner = new AgentRunner(undefined, mockProvider, { milestoneEmitter: emitter });

  await runner.run(sampleBlueprint, sampleRequest);

  const started = emitter.milestones.find((m) => m.milestoneType === MILESTONE_LLM_CALL_STARTED);
  assertExists(started, "llm.call.started milestone should be emitted");
});

Deno.test("AgentRunner: emits llm.call.completed after successful LLM call", async () => {
  const emitter = new MockMilestoneEmitter();
  const mockProvider = new MockProvider(wellFormedResponse);
  const runner = new AgentRunner(undefined, mockProvider, { milestoneEmitter: emitter });

  await runner.run(sampleBlueprint, sampleRequest);

  const completed = emitter.milestones.find((m) => m.milestoneType === MILESTONE_LLM_CALL_COMPLETED);
  assertExists(completed, "llm.call.completed milestone should be emitted");
});

Deno.test("AgentRunner: llm.call.started precedes llm.call.completed", async () => {
  const emitter = new MockMilestoneEmitter();
  const mockProvider = new MockProvider(wellFormedResponse);
  const runner = new AgentRunner(undefined, mockProvider, { milestoneEmitter: emitter });

  await runner.run(sampleBlueprint, sampleRequest);

  const startedIdx = emitter.milestones.findIndex((m) => m.milestoneType === MILESTONE_LLM_CALL_STARTED);
  const completedIdx = emitter.milestones.findIndex((m) => m.milestoneType === MILESTONE_LLM_CALL_COMPLETED);
  assertEquals(startedIdx >= 0, true, "started should exist");
  assertEquals(completedIdx >= 0, true, "completed should exist");
  assertEquals(startedIdx < completedIdx, true, "started should precede completed");
});

Deno.test("AgentRunner: emits no milestones when milestoneEmitter is not configured", async () => {
  const mockProvider = new MockProvider(wellFormedResponse);
  const runner = new AgentRunner(undefined, mockProvider, {});

  const result = await runner.run(sampleBlueprint, sampleRequest);
  assertExists(result);
  assertEquals(result.content, 'console.log("Hello");');
});

Deno.test("AgentRunner: sets traceId on milestones when request has traceId", async () => {
  const emitter = new MockMilestoneEmitter();
  const mockProvider = new MockProvider(wellFormedResponse);
  const runner = new AgentRunner(undefined, mockProvider, { milestoneEmitter: emitter });

  await runner.run(sampleBlueprint, { ...sampleRequest, traceId: "test-trace-123" });

  const started = emitter.milestones.find((m) => m.milestoneType === MILESTONE_LLM_CALL_STARTED);
  assertEquals(started?.traceId, "test-trace-123", "milestone should carry traceId");
});
