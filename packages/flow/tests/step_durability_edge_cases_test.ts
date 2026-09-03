/**
 * @module StepDurabilityEdgeCasesTest
 * @path packages/flow/tests/step_durability_edge_cases_test.ts
 * @description Edge-case tests for FlowRunner step durability — duplicate
 * recordId handling, empty inputs, concurrent persistence, store errors.
 */

import { assertEquals, assertRejects } from "@std/assert";
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
import { DEFAULT_FLOW_STEP_BACKOFF_MS, DEFAULT_FLOW_VERSION, FlowInputSource, FlowOutputFormat } from "@exaix/core";

class RecordingStore implements IStepDurabilityStore {
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

class SimpleAgentRunner implements IAgentExecutor {
  callCount = 0;
  results: Map<string, string> = new Map();

  constructor(results: Record<string, string>) {
    for (const [k, v] of Object.entries(results)) {
      this.results.set(k, v);
    }
  }

  async run(agentRole: string, _request: IFlowStepRequest): Promise<IAgentExecutionResult> {
    this.callCount++;
    const content = this.results.get(agentRole) ?? `result-${agentRole}`;
    return await Promise.resolve({ thought: "edge", content, raw: content });
  }
}

class MockEventLogger implements IFlowEventLogger {
  events: Array<{ event: string; payload: Record<string, JSONValue | undefined> }> = [];

  log(event: string, payload: Record<string, JSONValue | undefined>) {
    this.events.push({ event, payload });
  }
}

class FailingStore implements IStepDurabilityStore {
  save(): Promise<void> {
    return Promise.reject(new Error("Store save failed"));
  }

  findReplayCandidate(): Promise<IStepExecutionRecord | null> {
    return Promise.resolve(null);
  }

  invalidate(): Promise<void> {
    return Promise.resolve();
  }
}

function buildFlow(steps: Array<{ id: string; agent_role: string; dependsOn?: string[] }>): IFlowInput {
  return {
    id: "edge-flow",
    name: "Edge Flow",
    description: "Test edge cases",
    version: DEFAULT_FLOW_VERSION,
    steps: steps.map((s) => ({
      id: s.id,
      name: s.id,
      agent_role: s.agent_role,
      dependsOn: s.dependsOn ?? [],
      input: { source: FlowInputSource.REQUEST, transform: "passthrough" },
      retry: { maxAttempts: 1, backoffMs: DEFAULT_FLOW_STEP_BACKOFF_MS },
    })),
    output: { from: [steps[steps.length - 1].id], format: FlowOutputFormat.MARKDOWN },
    settings: { maxParallelism: 3, failFast: true },
  } as IFlowInput;
}

Deno.test("StepDurabilityEdge: empty userPrompt still produces a valid input hash", async () => {
  const store = new RecordingStore();
  const agent = new SimpleAgentRunner({ agentA: "result" });
  const logger = new MockEventLogger();
  const runner = new FlowRunner({ agentExecutor: agent, eventLogger: logger, stepDurabilityStore: store });

  const flow = buildFlow([{ id: "step1", agent_role: "agentA" }]);
  const result = await runner.execute(flow as IFlow, { userPrompt: "" });

  assertEquals(result.success, true);
  assertEquals(store.savedRecords.length, 1);
  const record = store.savedRecords[0];
  assertEquals(typeof record.inputHash, "string");
  assertEquals(record.inputHash.length >= 32, true, "empty prompt should still produce 32+ char hash");
});

Deno.test("StepDurabilityEdge: records are isolated by traceId", async () => {
  const store = new RecordingStore();
  const agent = new SimpleAgentRunner({ agentA: "result" });
  const logger = new MockEventLogger();
  const runner = new FlowRunner({ agentExecutor: agent, eventLogger: logger, stepDurabilityStore: store });

  const flow = buildFlow([{ id: "step1", agent_role: "agentA" }]);

  await runner.execute(flow as IFlow, { userPrompt: "run a", traceId: "trace-a" });
  await runner.execute(flow as IFlow, { userPrompt: "run b", traceId: "trace-b" });

  assertEquals(store.savedRecords.length, 2);
  const traceIds = store.savedRecords.map((r) => r.idempotencyKey.traceId);
  assertEquals(traceIds.filter((t) => t === "trace-a").length, 1);
  assertEquals(traceIds.filter((t) => t === "trace-b").length, 1);
});

Deno.test("StepDurabilityEdge: concurrent parallel steps produce unique recordIds", async () => {
  const store = new RecordingStore();
  const agent = new SimpleAgentRunner({ agentA: "a", agentB: "b" });
  const logger = new MockEventLogger();
  const runner = new FlowRunner({ agentExecutor: agent, eventLogger: logger, stepDurabilityStore: store });

  const flow = buildFlow([
    { id: "stepA", agent_role: "agentA" },
    { id: "stepB", agent_role: "agentB" },
  ]);

  await runner.execute(flow as IFlow, { userPrompt: "parallel" });

  assertEquals(store.savedRecords.length, 2);
  const ids = store.savedRecords.map((r) => r.recordId);
  assertEquals(new Set(ids).size, 2, "recordIds must be unique");
});

Deno.test("StepDurabilityEdge: store save error does not crash flow — error propagates", async () => {
  const store = new FailingStore();
  const agent = new SimpleAgentRunner({ agentA: "result" });
  const logger = new MockEventLogger();
  const runner = new FlowRunner({ agentExecutor: agent, eventLogger: logger, stepDurabilityStore: store });

  const flow = buildFlow([{ id: "step1", agent_role: "agentA" }]);

  await assertRejects(
    () => runner.execute(flow as IFlow, { userPrompt: "store error" }),
    Error,
    "Store save failed",
  );
});

Deno.test("StepDurabilityEdge: idempotencyKey uses attemptClass from the step context", async () => {
  const store = new RecordingStore();
  const agent = new SimpleAgentRunner({ agentA: "result" });
  const logger = new MockEventLogger();
  const runner = new FlowRunner({ agentExecutor: agent, eventLogger: logger, stepDurabilityStore: store });

  const flow = buildFlow([{ id: "step1", agent_role: "agentA" }]);
  await runner.execute(flow as IFlow, { userPrompt: "attempt test" });

  const record = store.savedRecords[0];
  assertEquals(record.idempotencyKey.attemptClass.length > 0, true);
  assertEquals(record.idempotencyKey.stepId, "step1");
  assertEquals(record.idempotencyKey.flowId, "edge-flow");
});

Deno.test("StepDurabilityEdge: computeStepInputHash produces deterministic output for same input", async () => {
  const store = new RecordingStore();
  const agent = new SimpleAgentRunner({ agentA: "result" });
  const logger = new MockEventLogger();
  const runner = new FlowRunner({ agentExecutor: agent, eventLogger: logger, stepDurabilityStore: store });

  const flow = buildFlow([{ id: "step1", agent_role: "agentA" }]);

  await runner.execute(flow as IFlow, { userPrompt: "deterministic" });
  await runner.execute(flow as IFlow, { userPrompt: "deterministic", traceId: "trace-2" });

  assertEquals(store.savedRecords.length, 2);
  assertEquals(
    store.savedRecords[0].idempotencyKey.inputHash,
    store.savedRecords[1].idempotencyKey.inputHash,
    "same input should produce same hash across runs",
  );
});
