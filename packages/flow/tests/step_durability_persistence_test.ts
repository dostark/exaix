/**
 * @module StepDurabilityPersistenceTest
 * @path packages/flow/tests/step_durability_persistence_test.ts
 * @description Unit tests verifying FlowRunner persists step execution records
 * for successful guarded steps with correct duration, disposition, and side-effect
 * classification.
 */

import { assertEquals, assertNotEquals } from "@std/assert";
import {
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
  StepAttemptClass,
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

class MockAgentRunner implements IAgentExecutor {
  private results: Map<string, IAgentExecutionResult> = new Map();

  constructor(results: Record<string, IAgentExecutionResult | string>) {
    for (const [key, result] of Object.entries(results)) {
      if (typeof result === "string") {
        this.results.set(key, { thought: "Mock thought", content: result, raw: result });
      } else {
        this.results.set(key, result);
      }
    }
  }

  async run(_agentRole: string, _request: IFlowStepRequest): Promise<IAgentExecutionResult> {
    const result = this.results.get(_agentRole);
    if (!result) {
      throw new Error(`No mock result for agent ${_agentRole}`);
    }
    return await Promise.resolve(result);
  }
}

class MockEventLogger implements IFlowEventLogger {
  events: Array<{ event: string; payload: Record<string, JSONValue | undefined> }> = [];

  log(event: string, payload: Record<string, JSONValue | undefined>) {
    this.events.push({ event, payload });
  }
}

function buildSimpleFlow(steps: Array<{ id: string; agent_role: string; dependsOn?: string[] }>): IFlowInput {
  return {
    id: "test-flow",
    name: "Test Flow",
    description: "A test flow for durability persistence",
    version: DEFAULT_FLOW_VERSION,
    steps: steps.map((s) => ({
      id: s.id,
      name: s.id,
      agent_role: s.agent_role,
      dependsOn: s.dependsOn ?? [],
      input: { source: FlowInputSource.REQUEST, transform: "passthrough" },
      retry: { maxAttempts: 1, backoffMs: DEFAULT_FLOW_STEP_BACKOFF_MS },
    })),
    output: {
      from: [steps[steps.length - 1].id],
      format: FlowOutputFormat.MARKDOWN,
    },
    settings: { maxParallelism: 3, failFast: true },
  } as IFlowInput;
}

Deno.test("StepDurabilityPersistence: saves a record for each successful step", async () => {
  const store = new RecordingDurabilityStore();
  const agent = new MockAgentRunner({ agent1: "result-1", agent2: "result-2" });
  const logger = new MockEventLogger();

  const runner = new FlowRunner({ agentExecutor: agent, eventLogger: logger, stepDurabilityStore: store });

  const flow = buildSimpleFlow([
    { id: "step1", agent_role: "agent1" },
    { id: "step2", agent_role: "agent2", dependsOn: ["step1"] },
  ]);

  const result = await runner.execute(flow as IFlow, { userPrompt: "test input" });

  assertEquals(result.success, true);
  assertEquals(store.savedRecords.length, 2);

  const record1 = store.savedRecords[0];
  assertEquals(record1.flowId, "test-flow");
  assertEquals(record1.stepId, "step1");
  assertEquals(record1.disposition, StepExecutionDisposition.EXECUTED);
  assertEquals(record1.replayEligible, true);
  assertEquals(record1.startedAt.length > 0, true);
  assertEquals(record1.inputHash.length >= 32, true);
  assertNotEquals(record1.recordId, "");

  const record2 = store.savedRecords[1];
  assertEquals(record2.stepId, "step2");
  assertEquals(record2.disposition, StepExecutionDisposition.EXECUTED);
});

Deno.test("StepDurabilityPersistence: records have valid idempotency keys", async () => {
  const store = new RecordingDurabilityStore();
  const agent = new MockAgentRunner({ agent1: "result" });
  const logger = new MockEventLogger();

  const runner = new FlowRunner({ agentExecutor: agent, eventLogger: logger, stepDurabilityStore: store });

  const flow = buildSimpleFlow([{ id: "step1", agent_role: "agent1" }]);
  await runner.execute(flow as IFlow, { userPrompt: "test input" });

  assertEquals(store.savedRecords.length, 1);
  const record = store.savedRecords[0];

  assertEquals(record.idempotencyKey.traceId.length > 0, true);
  assertEquals(record.idempotencyKey.flowId, "test-flow");
  assertEquals(record.idempotencyKey.stepId, "step1");
  assertEquals(record.idempotencyKey.attemptClass, StepAttemptClass.INITIAL);
  assertEquals(record.idempotencyKey.inputHash.length >= 32, true);

  assertEquals(record.disposition, StepExecutionDisposition.EXECUTED);
});

Deno.test("StepDurabilityPersistence: sets sideEffectClass on each record", async () => {
  const store = new RecordingDurabilityStore();
  const agent = new MockAgentRunner({ agent1: "result" });
  const logger = new MockEventLogger();

  const runner = new FlowRunner({ agentExecutor: agent, eventLogger: logger, stepDurabilityStore: store });

  const flow = buildSimpleFlow([{ id: "step1", agent_role: "agent1" }]);
  await runner.execute(flow as IFlow, { userPrompt: "test" });

  assertEquals(store.savedRecords.length, 1);
  const record = store.savedRecords[0];
  assertEquals(typeof record.sideEffectClass, "string");
});

Deno.test("StepDurabilityPersistence: does not crash when no store is provided", async () => {
  const agent = new MockAgentRunner({ agent1: "result" });
  const logger = new MockEventLogger();

  const runner = new FlowRunner({ agentExecutor: agent, eventLogger: logger });

  const flow = buildSimpleFlow([{ id: "step1", agent_role: "agent1" }]);
  const result = await runner.execute(flow as IFlow, { userPrompt: "test" });

  assertEquals(result.success, true);
});

Deno.test("StepDurabilityPersistence: durationMs is populated and non-negative on successful step records", async () => {
  const store = new RecordingDurabilityStore();
  const agent = new MockAgentRunner({ agent1: "result" });
  const logger = new MockEventLogger();

  const runner = new FlowRunner({ agentExecutor: agent, eventLogger: logger, stepDurabilityStore: store });

  const flow = buildSimpleFlow([{ id: "step1", agent_role: "agent1" }]);
  await runner.execute(flow as IFlow, { userPrompt: "test" });

  assertEquals(store.savedRecords.length, 1);
  const record = store.savedRecords[0];
  assertEquals(typeof record.durationMs, "number", "durationMs must be a number on successful records");
  assertEquals(record.durationMs! >= 0, true, "durationMs must be non-negative");
});
