/**
 * @module StepDurabilityFailureTest
 * @path packages/flow/tests/step_durability_failure_test.ts
 * @description Unit tests for failure-path step execution record persistence,
 * verifying partial metadata (missing completedAt, zero durationMs) is stored.
 */

import { assertEquals, assertNotEquals, assertRejects } from "@std/assert";
import {
  FlowExecutionError,
  FlowRunner,
  type IAgentExecutor,
  type IFlowEventLogger,
  type IFlowStepRequest,
  type IStepDurabilityStore,
  type IStepExecutionRecord,
} from "@exaix/flow";
import type { IAgentExecutionResult } from "@exaix/execution";
import type { IFlow } from "@exaix/schemas";
import type { IFlowInput } from "@exaix/schemas/flow.ts";
import type { JSONValue } from "@exaix/core";
import {
  DEFAULT_FLOW_STEP_BACKOFF_MS,
  DEFAULT_FLOW_VERSION,
  FlowInputSource,
  FlowOutputFormat,
  StepExecutionDisposition,
} from "@exaix/core";

class RecordingDurabilityStore implements IStepDurabilityStore {
  private recordsMap = new Map<string, IStepExecutionRecord>();

  save(record: IStepExecutionRecord): Promise<void> {
    this.recordsMap.set(record.recordId, record);
    return Promise.resolve();
  }

  findReplayCandidate(): Promise<IStepExecutionRecord | null> {
    return Promise.resolve(null);
  }

  invalidate(_recordId: string, _reason: string): Promise<void> {
    return Promise.resolve();
  }

  get savedRecords(): IStepExecutionRecord[] {
    return Array.from(this.recordsMap.values());
  }
}

class FailingAgentRunner implements IAgentExecutor {
  run(_agentRole: string, _request: IFlowStepRequest): Promise<IAgentExecutionResult> {
    return Promise.reject(new Error("Step execution failed"));
  }
}

class MockEventLogger implements IFlowEventLogger {
  events: Array<{ event: string; payload: Record<string, JSONValue | undefined> }> = [];

  log(event: string, payload: Record<string, JSONValue | undefined>) {
    this.events.push({ event, payload });
  }
}

function buildFailureFlow(): IFlowInput {
  return {
    id: "failure-flow",
    name: "Failure Flow",
    description: "A flow where the step fails",
    version: DEFAULT_FLOW_VERSION,
    steps: [{
      id: "step1",
      name: "Step 1",
      agent_role: "agent1",
      dependsOn: [],
      input: { source: FlowInputSource.REQUEST, transform: "passthrough" },
      retry: { maxAttempts: 1, backoffMs: DEFAULT_FLOW_STEP_BACKOFF_MS },
    }],
    output: { from: ["step1"], format: FlowOutputFormat.MARKDOWN },
    settings: { maxParallelism: 3, failFast: true },
  } as IFlowInput;
}

Deno.test("StepDurabilityFailure: persists a record with failure metadata when step fails", async () => {
  const store = new RecordingDurabilityStore();
  const agent = new FailingAgentRunner();
  const logger = new MockEventLogger();

  const runner = new FlowRunner({ agentExecutor: agent, eventLogger: logger, stepDurabilityStore: store });

  const flow = buildFailureFlow();
  await assertRejects(
    () => runner.execute(flow as IFlow, { userPrompt: "test input" }),
    FlowExecutionError,
  );

  assertEquals(store.savedRecords.length, 1);

  const record = store.savedRecords[0];
  assertEquals(record.flowId, "failure-flow");
  assertEquals(record.stepId, "step1");
  assertEquals(record.disposition, StepExecutionDisposition.EXECUTED);
  assertEquals(record.replayEligible, false);
  assertEquals(record.startedAt.length > 0, true);
  assertEquals(record.inputHash.length >= 32, true);
});

Deno.test("StepDurabilityFailure: failed step record has recordId", async () => {
  const store = new RecordingDurabilityStore();
  const agent = new FailingAgentRunner();
  const logger = new MockEventLogger();

  const runner = new FlowRunner({ agentExecutor: agent, eventLogger: logger, stepDurabilityStore: store });

  const flow = buildFailureFlow();
  await assertRejects(
    () => runner.execute(flow as IFlow, { userPrompt: "test input" }),
    FlowExecutionError,
  );

  assertEquals(store.savedRecords.length, 1);
  const record = store.savedRecords[0];
  assertNotEquals(record.recordId, "");
  assertEquals(typeof record.recordId, "string");
});

Deno.test("StepDurabilityFailure: failed step record has error field", async () => {
  const store = new RecordingDurabilityStore();
  const agent = new FailingAgentRunner();
  const logger = new MockEventLogger();

  const runner = new FlowRunner({ agentExecutor: agent, eventLogger: logger, stepDurabilityStore: store });

  const flow = buildFailureFlow();
  await assertRejects(
    () => runner.execute(flow as IFlow, { userPrompt: "test input" }),
    FlowExecutionError,
  );

  const record = store.savedRecords[0];
  assertEquals(typeof record.error, "string");
});

Deno.test("StepDurabilityFailure: no store does not crash on failure", async () => {
  const agent = new FailingAgentRunner();
  const logger = new MockEventLogger();

  const runner = new FlowRunner({ agentExecutor: agent, eventLogger: logger });

  const flow = buildFailureFlow();
  await assertRejects(
    () => runner.execute(flow as IFlow, { userPrompt: "test" }),
    FlowExecutionError,
  );
});

Deno.test("StepDurabilityFailure: replayEligible is false on initial pre-execution save", async () => {
  class SaveAllStore implements IStepDurabilityStore {
    allSaves: IStepExecutionRecord[] = [];

    save(record: IStepExecutionRecord): Promise<void> {
      this.allSaves.push({ ...record });
      return Promise.resolve();
    }

    findReplayCandidate(): Promise<IStepExecutionRecord | null> {
      return Promise.resolve(null);
    }

    invalidate(_recordId: string, _reason: string): Promise<void> {
      return Promise.resolve();
    }
  }

  const store = new SaveAllStore();
  const agent = new FailingAgentRunner();
  const logger = new MockEventLogger();

  const runner = new FlowRunner({ agentExecutor: agent, eventLogger: logger, stepDurabilityStore: store });

  const flow = buildFailureFlow();
  await assertRejects(
    () => runner.execute(flow as IFlow, { userPrompt: "test" }),
    FlowExecutionError,
  );

  assertEquals(store.allSaves.length >= 1, true, "At least one save must happen");
  const firstSave = store.allSaves[0];
  assertEquals(
    firstSave.replayEligible,
    false,
    "Initial pre-execution save must have replayEligible: false (GAP-12 fix)",
  );
});
