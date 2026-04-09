/**
 * @module FlowRunnerTest
 * @path tests/flows/flow_runner_test.ts
 * @description Core execution tests for the FlowRunner, verifying wave-based parallel step execution,
 * state propagation between steps, and fail-fast behavior during workflow interruptions.
 */

import { assert, assertEquals, assertRejects } from "@std/assert";
import { FlowInputSource, FlowOutputFormat, FlowStepOnErrorAction } from "../../src/shared/enums.ts";
import {
  FlowAbortError,
  FlowExecutionError,
  FlowRunner,
  type IAgentExecutor,
  type IFlowEventLogger,
  type IFlowStepRequest,
} from "../../src/flows/flow_runner.ts";
import type { Config } from "../../src/shared/schemas/config.ts";
import type { IFlow, IFlowInput, IFlowStepInput } from "../../src/shared/schemas/flow.ts";
import type { IAgentExecutionResult } from "../../src/services/agent/agent_runner.ts";
import { RetryPolicy } from "../../src/services/core/retry_policy.ts";
import { DEFAULT_FLOW_VERSION, PROVIDER_ANTHROPIC, PROVIDER_OPENAI } from "../../src/shared/constants.ts";
import type { JSONValue } from "../../src/shared/types/json.ts";
import type { ActivityRecord, SqliteParam } from "../../src/services/core/db.ts";
import type { IJournalFilterOptions } from "../../src/shared/types/database.ts";
import { createMockConfig } from "../helpers/config.ts";

/** Local type matching the shape logged by FlowRunner for flow.token_summary events */
interface TokenSummary {
  totalLlmCalls: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  totalCostUsd: number;
  providers: Record<string, { calls: number; inputTokens: number; outputTokens: number; costUsd: number }>;
}

// Mock AgentRunner for testing
class MockAgentRunner implements IAgentExecutor {
  private results: Map<string, IAgentExecutionResult> = new Map();
  private failures: Set<string> = new Set();

  constructor(results: Record<string, IAgentExecutionResult | string> = {}, failures: string[] = []) {
    for (const [key, result] of Object.entries(results)) {
      if (typeof result === "string") {
        this.results.set(key, { thought: "Mock thought", content: result, raw: result });
      } else {
        this.results.set(key, result);
      }
    }
    for (const failure of failures) {
      this.failures.add(failure);
    }
  }

  async run(identityId: string, _request: IFlowStepRequest): Promise<IAgentExecutionResult> {
    if (this.failures.has(identityId)) {
      throw new Error(`Mock failure for agent ${identityId}`);
    }
    const result = this.results.get(identityId);
    if (!result) {
      throw new Error(`No mock result for agent ${identityId}`);
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

class SequencedMockAgentRunner implements IAgentExecutor {
  private readonly sequences = new Map<string, Array<IAgentExecutionResult | Error>>();
  calls: string[] = [];

  constructor(sequences: Record<string, Array<IAgentExecutionResult | Error | string>>) {
    for (const [identityId, results] of Object.entries(sequences)) {
      this.sequences.set(
        identityId,
        results.map((result) => {
          if (typeof result === "string") {
            return { thought: "Mock thought", content: result, raw: result };
          }
          return result;
        }),
      );
    }
  }

  async run(identityId: string, _request: IFlowStepRequest): Promise<IAgentExecutionResult> {
    this.calls.push(identityId);
    const sequence = this.sequences.get(identityId);
    if (!sequence || sequence.length === 0) {
      throw new Error(`No mock sequence result for agent ${identityId}`);
    }

    const next = sequence.shift()!;
    if (next instanceof Error) {
      throw next;
    }

    return await Promise.resolve(next);
  }
}

// Test FlowRunner class
Deno.test("FlowRunner: executes simple sequential flow", async () => {
  const steps: IFlowStepInput[] = [
    {
      id: "step1",
      name: "Step 1",
      identity: "agent1",
      dependsOn: [],
      input: { source: FlowInputSource.REQUEST, transform: "passthrough" },
      retry: { maxAttempts: 1, backoffMs: 1000 },
    },
    {
      id: "step2",
      name: "Step 2",
      identity: "agent2",
      dependsOn: ["step1"],
      input: { source: FlowInputSource.STEP, stepId: "step1", transform: "passthrough" },
      retry: { maxAttempts: 1, backoffMs: 1000 },
    },
  ];

  const flow: IFlowInput = {
    id: "test-flow",
    name: "Test IFlow as IFlow",
    description: "A test flow",
    version: DEFAULT_FLOW_VERSION,
    steps,
    output: { from: "step2", format: FlowOutputFormat.MARKDOWN },
    settings: { maxParallelism: 3, failFast: true },
  };

  const mockResults = {
    agent1: { thought: "Thinking 1", content: "Result 1", raw: "raw result 1" },
    agent2: { thought: "Thinking 2", content: "Result 2", raw: "raw result 2" },
  };

  const mockAgentRunner = new MockAgentRunner(mockResults);
  const mockLogger = new MockEventLogger();

  const runner = new FlowRunner({ agentExecutor: mockAgentRunner, eventLogger: mockLogger });
  const result = await runner.execute(flow as IFlow, { userPrompt: "test request" });

  assertEquals(result.flowRunId.length, 36); // UUID length
  assertEquals(result.stepResults.size, 2);
  assertEquals(result.stepResults.get("step1")?.result?.content, "Result 1");
  assertEquals(result.stepResults.get("step2")?.result?.content, "Result 2");
  assertEquals(result.output, "Result 2");
  assertEquals(result.success, true);

  // Check logging events - comprehensive flow execution logging
  assertEquals(mockLogger.events.length, 22); // All flow and step lifecycle events
  assertEquals(mockLogger.events[0].event, "flow.validating");
  assertEquals(mockLogger.events[1].event, "flow.validated");
  assertEquals(mockLogger.events[2].event, "flow.started");
  assertEquals(mockLogger.events[3].event, "flow.dependencies.resolving");
  assertEquals(mockLogger.events[4].event, "flow.dependencies.resolved");
  assertEquals(mockLogger.events[5].event, "flow.wave.started");
  assertEquals(mockLogger.events[6].event, "flow.step.queued");
  assertEquals(mockLogger.events[7].event, "flow.step.started");
  assertEquals(mockLogger.events[8].event, "flow.step.transform.applied");
  assertEquals(mockLogger.events[9].event, "flow.step.input.prepared");
  assertEquals(mockLogger.events[10].event, "flow.step.completed");
  assertEquals(mockLogger.events[11].event, "flow.wave.completed");
  assertEquals(mockLogger.events[12].event, "flow.wave.started");
  assertEquals(mockLogger.events[13].event, "flow.step.queued");
  assertEquals(mockLogger.events[14].event, "flow.step.started");
  assertEquals(mockLogger.events[15].event, "flow.step.transform.applied");
  assertEquals(mockLogger.events[16].event, "flow.step.input.prepared");
  assertEquals(mockLogger.events[17].event, "flow.step.completed");
  assertEquals(mockLogger.events[18].event, "flow.wave.completed");
  assertEquals(mockLogger.events[19].event, "flow.output.aggregating");
  assertEquals(mockLogger.events[20].event, "flow.output.aggregated");
  assertEquals(mockLogger.events[21].event, "flow.completed");
});

Deno.test("FlowRunner: executes parallel steps in same wave", async () => {
  const steps: IFlowStepInput[] = [
    {
      id: "start",
      name: "Start",
      identity: "agent1",
      dependsOn: [],
      input: { source: FlowInputSource.REQUEST, transform: "passthrough" },
      retry: { maxAttempts: 1, backoffMs: 1000 },
    },
    {
      id: "parallel1",
      name: "Parallel 1",
      identity: "agent2",
      dependsOn: ["start"],
      input: { source: FlowInputSource.STEP, stepId: "start", transform: "passthrough" },
      retry: { maxAttempts: 1, backoffMs: 1000 },
    },
    {
      id: "parallel2",
      name: "Parallel 2",
      identity: "agent3",
      dependsOn: ["start"],
      input: { source: FlowInputSource.STEP, stepId: "start", transform: "passthrough" },
      retry: { maxAttempts: 1, backoffMs: 1000 },
    },
  ];

  const flow: IFlowInput = {
    id: "parallel-flow",
    name: "Parallel Flow",
    description: "A flow with parallel steps",
    version: DEFAULT_FLOW_VERSION,
    steps,
    output: { from: ["parallel1", "parallel2"], format: FlowOutputFormat.CONCAT },
    settings: { maxParallelism: 3, failFast: true },
  };

  const mockResults = {
    agent1: { thought: "Start thinking", content: "Start result", raw: "raw start" },
    agent2: { thought: "Parallel 1 thinking", content: "Parallel 1 result", raw: "raw parallel 1" },
    agent3: { thought: "Parallel 2 thinking", content: "Parallel 2 result", raw: "raw parallel 2" },
  };

  const mockAgentRunner = new MockAgentRunner(mockResults);
  const mockLogger = new MockEventLogger();

  const runner = new FlowRunner({ agentExecutor: mockAgentRunner, eventLogger: mockLogger });
  const result = await runner.execute(flow as IFlow, { userPrompt: "test request" });

  assertEquals(result.stepResults.size, 3);
  assertEquals(result.success, true);
  assertEquals(result.output, "Parallel 1 result\nParallel 2 result");
});

Deno.test("FlowRunner: handles failFast behavior", async () => {
  const steps: IFlowStepInput[] = [
    {
      id: "step1",
      name: "Step 1",
      identity: "agent1",
      dependsOn: [],
      input: { source: FlowInputSource.REQUEST, transform: "passthrough" },
      retry: { maxAttempts: 1, backoffMs: 1000 },
    },
    {
      id: "step2",
      name: "Step 2",
      identity: "failing-agent",
      dependsOn: ["step1"],
      input: { source: FlowInputSource.STEP, stepId: "step1", transform: "passthrough" },
      retry: { maxAttempts: 1, backoffMs: 1000 },
    },
    {
      id: "step3",
      name: "Step 3",
      identity: "agent3",
      dependsOn: ["step2"],
      input: { source: FlowInputSource.STEP, stepId: "step2", transform: "passthrough" },
      retry: { maxAttempts: 1, backoffMs: 1000 },
    },
  ];

  const flow: IFlowInput = {
    id: "failfast-flow",
    name: "FailFast Flow",
    description: "A flow that fails fast",
    version: DEFAULT_FLOW_VERSION,
    steps,
    output: { from: "step3", format: FlowOutputFormat.MARKDOWN },
    settings: { maxParallelism: 3, failFast: true },
  };

  const mockResults = {
    agent1: { thought: "Step 1 thinking", content: "Step 1 result", raw: "raw step 1" },
    agent3: { thought: "Step 3 thinking", content: "Step 3 result", raw: "raw step 3" },
  };

  const mockAgentRunner = new MockAgentRunner(mockResults, ["failing-agent"]);
  const mockLogger = new MockEventLogger();

  const runner = new FlowRunner({ agentExecutor: mockAgentRunner, eventLogger: mockLogger });

  try {
    await runner.execute(flow as IFlow, { userPrompt: "test request" });
    throw new Error("Expected FlowExecutionError to be thrown");
  } catch (error) {
    assert(error instanceof FlowExecutionError);
    assert(error.message.includes("Step step2 failed"));
  }
});

Deno.test("FlowRunner: retries a failed step until it succeeds", async () => {
  const steps: IFlowStepInput[] = [
    {
      id: "step1",
      name: "Retrying Step",
      identity: "flaky-agent",
      dependsOn: [],
      input: { source: FlowInputSource.REQUEST, transform: "passthrough" },
      onError: { action: FlowStepOnErrorAction.RETRY, maxRetries: 2 },
      retry: { maxAttempts: 1, backoffMs: 1000 },
    },
  ];

  const flow: IFlowInput = {
    id: "retry-flow",
    name: "Retry Flow",
    description: "Retries a flaky step",
    version: DEFAULT_FLOW_VERSION,
    steps,
    output: { from: "step1", format: FlowOutputFormat.MARKDOWN },
    settings: { maxParallelism: 3, failFast: true },
  };

  const mockAgentRunner = new SequencedMockAgentRunner({
    "flaky-agent": [
      new Error("temporary failure 1"),
      new Error("temporary failure 2"),
      "Recovered result",
    ],
  });
  const mockLogger = new MockEventLogger();

  const runner = new FlowRunner({ agentExecutor: mockAgentRunner, eventLogger: mockLogger });
  const result = await runner.execute(flow as IFlow, { userPrompt: "test request" });

  assertEquals(result.success, true);
  assertEquals(result.output, "Recovered result");
  assertEquals(mockAgentRunner.calls, ["flaky-agent", "flaky-agent", "flaky-agent"]);

  const retryEvents = mockLogger.events.filter((event) => event.event === "flow.step.retry");
  assertEquals(retryEvents.length, 2);
  assertEquals(retryEvents[0].payload.stepId, "step1");
  assertEquals(retryEvents[0].payload.attempt, 1);
  assertEquals(retryEvents[0].payload.error, "temporary failure 1");
  assertEquals(retryEvents[0].payload.maxRetries, 2);
  assertEquals(retryEvents[1].payload.attempt, 2);
  assertEquals(retryEvents[1].payload.error, "temporary failure 2");
  assertEquals(retryEvents[1].payload.maxRetries, 2);
});

Deno.test("FlowRunner: retry backoff is skipped in test mode", async () => {
  const steps: IFlowStepInput[] = [
    {
      id: "step1",
      name: "Retrying Step",
      identity: "flaky-agent",
      dependsOn: [],
      input: { source: FlowInputSource.REQUEST, transform: "passthrough" },
      onError: { action: FlowStepOnErrorAction.RETRY, maxRetries: 2, backoffMs: 250 },
      retry: { maxAttempts: 1, backoffMs: 1000 },
    },
  ];

  const flow: IFlowInput = {
    id: "retry-flow-test-mode",
    name: "Retry Flow Test Mode",
    description: "Retries a flaky step without waiting in tests",
    version: DEFAULT_FLOW_VERSION,
    steps,
    output: { from: "step1", format: FlowOutputFormat.MARKDOWN },
    settings: { maxParallelism: 3, failFast: true },
  };

  const mockAgentRunner = new SequencedMockAgentRunner({
    "flaky-agent": [
      new Error("temporary failure 1"),
      new Error("temporary failure 2"),
      "Recovered result",
    ],
  });
  const mockLogger = new MockEventLogger();
  const runner = new FlowRunner({ agentExecutor: mockAgentRunner, eventLogger: mockLogger });

  const originalCalculateDelay = RetryPolicy.prototype.calculateDelay;
  const previousTestMode = Deno.env.get("DENO_TEST");
  const delayAttempts: number[] = [];

  RetryPolicy.prototype.calculateDelay = function (attempt: number): number {
    delayAttempts.push(attempt);
    return originalCalculateDelay.call(this, attempt);
  };
  Deno.env.set("DENO_TEST", "1");

  try {
    const startedAt = Date.now();
    const result = await runner.execute(flow as IFlow, { userPrompt: "test request" });
    const durationMs = Date.now() - startedAt;

    assertEquals(result.success, true);
    assertEquals(result.output, "Recovered result");
    assertEquals(delayAttempts, [1, 2]);
    assert(durationMs < 500, `expected retry backoff to be skipped in tests, got ${durationMs}ms`);
  } finally {
    RetryPolicy.prototype.calculateDelay = originalCalculateDelay;
    if (previousTestMode === undefined) {
      Deno.env.delete("DENO_TEST");
    } else {
      Deno.env.set("DENO_TEST", previousTestMode);
    }
  }
});

Deno.test("FlowRunner: falls back to a recovery step when primary step fails", async () => {
  const steps: IFlowStepInput[] = [
    {
      id: "primary",
      name: "Primary Step",
      identity: "failing-agent",
      dependsOn: [],
      input: { source: FlowInputSource.REQUEST, transform: "passthrough" },
      onError: { action: FlowStepOnErrorAction.FALLBACK, fallbackStep: "fallback" },
      retry: { maxAttempts: 1, backoffMs: 1000 },
    },
    {
      id: "fallback",
      name: "Fallback Step",
      identity: "fallback-agent",
      dependsOn: ["primary"],
      condition: "results['primary']?.success !== true",
      input: { source: FlowInputSource.REQUEST, transform: "passthrough" },
      retry: { maxAttempts: 1, backoffMs: 1000 },
    },
  ];

  const flow: IFlowInput = {
    id: "fallback-flow",
    name: "Fallback Flow",
    description: "Falls back to a secondary step",
    version: DEFAULT_FLOW_VERSION,
    steps,
    output: { from: "primary", format: FlowOutputFormat.MARKDOWN },
    settings: { maxParallelism: 3, failFast: true },
  };

  const mockAgentRunner = new SequencedMockAgentRunner({
    "failing-agent": [new Error("primary failed")],
    "fallback-agent": ["Fallback result"],
  });
  const mockLogger = new MockEventLogger();

  const runner = new FlowRunner({ agentExecutor: mockAgentRunner, eventLogger: mockLogger });
  const result = await runner.execute(flow as IFlow, { userPrompt: "test request" });

  assertEquals(result.success, true);
  assertEquals(result.output, "Fallback result");
  assertEquals(mockAgentRunner.calls, ["failing-agent", "fallback-agent"]);

  const fallbackEvents = mockLogger.events.filter((event) => event.event === "flow.step.fallback");
  assertEquals(fallbackEvents.length, 1);
  assertEquals(fallbackEvents[0].payload.stepId, "primary");
  assertEquals(fallbackEvents[0].payload.fallbackStepId, "fallback");
  assertEquals(fallbackEvents[0].payload.fallbackIdentityId, "fallback-agent");
  assertEquals(fallbackEvents[0].payload.error, "primary failed");
});

Deno.test("FlowRunner: fallback step retries according to its own onError policy", async () => {
  const steps: IFlowStepInput[] = [
    {
      id: "primary",
      name: "Primary Step",
      identity: "primary-agent",
      dependsOn: [],
      input: { source: FlowInputSource.REQUEST, transform: "passthrough" },
      onError: { action: FlowStepOnErrorAction.FALLBACK, fallbackStep: "fallback" },
      retry: { maxAttempts: 1, backoffMs: 1000 },
    },
    {
      id: "fallback",
      name: "Fallback Step",
      identity: "fallback-agent",
      dependsOn: ["primary"],
      condition: "results['primary']?.success !== true",
      input: { source: FlowInputSource.REQUEST, transform: "passthrough" },
      onError: { action: FlowStepOnErrorAction.RETRY, maxRetries: 2 },
      retry: { maxAttempts: 1, backoffMs: 1000 },
    },
  ];

  const flow: IFlowInput = {
    id: "fallback-retry-flow",
    name: "Fallback Retry Flow",
    description: "Fallback step retries when it fails",
    version: DEFAULT_FLOW_VERSION,
    steps,
    output: { from: "primary", format: FlowOutputFormat.MARKDOWN },
    settings: { maxParallelism: 3, failFast: true },
  };

  const mockAgentRunner = new SequencedMockAgentRunner({
    "primary-agent": [new Error("primary failed")],
    "fallback-agent": [
      new Error("fallback failed 1"),
      new Error("fallback failed 2"),
      "Recovered through fallback retry",
    ],
  });
  const mockLogger = new MockEventLogger();

  const runner = new FlowRunner({ agentExecutor: mockAgentRunner, eventLogger: mockLogger });
  const result = await runner.execute(flow as IFlow, { userPrompt: "test request" });

  assertEquals(result.success, true);
  assertEquals(result.output, "Recovered through fallback retry");
  assertEquals(mockAgentRunner.calls, ["primary-agent", "fallback-agent", "fallback-agent", "fallback-agent"]);

  const retryEvents = mockLogger.events.filter((event) => event.event === "flow.step.retry");
  assertEquals(retryEvents.length, 2);
  assertEquals(retryEvents[0].payload.stepId, "fallback");
  assertEquals(retryEvents[0].payload.error, "fallback failed 1");
  assertEquals(retryEvents[1].payload.stepId, "fallback");
  assertEquals(retryEvents[1].payload.error, "fallback failed 2");
});

Deno.test("FlowRunner: abort action throws FlowAbortError with originating step id", async () => {
  const steps: IFlowStepInput[] = [
    {
      id: "step1",
      name: "Abort Step",
      identity: "always-fails",
      dependsOn: [],
      input: { source: FlowInputSource.REQUEST, transform: "passthrough" },
      onError: { action: FlowStepOnErrorAction.ABORT },
      retry: { maxAttempts: 1, backoffMs: 1000 },
    },
  ];

  const flow: IFlowInput = {
    id: "abort-flow",
    name: "Abort Flow",
    description: "Aborts immediately on step failure",
    version: DEFAULT_FLOW_VERSION,
    steps,
    output: { from: "step1", format: FlowOutputFormat.MARKDOWN },
    settings: { maxParallelism: 3, failFast: true },
  };

  const mockAgentRunner = new SequencedMockAgentRunner({
    "always-fails": [new Error("fatal failure")],
  });
  const mockLogger = new MockEventLogger();
  const runner = new FlowRunner({ agentExecutor: mockAgentRunner, eventLogger: mockLogger });

  await assertRejects(
    async () => await runner.execute(flow as IFlow, { userPrompt: "test request" }),
    FlowAbortError,
    "fatal failure",
  );
});

Deno.test("FlowRunner: continues execution when failFast is false", async () => {
  const steps: IFlowStepInput[] = [
    {
      id: "step1",
      name: "Step 1",
      identity: "agent1",
      dependsOn: [],
      input: { source: FlowInputSource.REQUEST, transform: "passthrough" },
      retry: { maxAttempts: 1, backoffMs: 1000 },
    },
    {
      id: "step2",
      name: "Step 2",
      identity: "failing-agent",
      dependsOn: ["step1"],
      input: { source: FlowInputSource.STEP, stepId: "step1", transform: "passthrough" },
      retry: { maxAttempts: 1, backoffMs: 1000 },
    },
  ];

  const flow: IFlowInput = {
    id: "continue-flow",
    name: "Continue Flow",
    description: "A flow that continues on failure",
    version: DEFAULT_FLOW_VERSION,
    steps,
    output: { from: "step1", format: FlowOutputFormat.MARKDOWN },
    settings: { maxParallelism: 3, failFast: false },
  };

  const mockResults = {
    agent1: { thought: "Step 1 thinking", content: "Step 1 result", raw: "raw step 1" },
  };

  const mockAgentRunner = new MockAgentRunner(mockResults, ["failing-agent"]);
  const mockLogger = new MockEventLogger();

  const runner = new FlowRunner({ agentExecutor: mockAgentRunner, eventLogger: mockLogger });
  const result = await runner.execute(flow as IFlow, { userPrompt: "test request" });

  assertEquals(result.stepResults.size, 2);
  assertEquals(result.stepResults.get("step1")?.success, true);
  assertEquals(result.stepResults.get("step2")?.success, false);
  assertEquals(result.success, false); // Overall flow failed but continued
  assertEquals(result.output, "Step 1 result");
});

Deno.test("FlowRunner: respects maxParallelism setting", async () => {
  const steps: IFlowStepInput[] = [
    {
      id: "start",
      name: "Start",
      identity: "agent1",
      dependsOn: [],
      input: { source: FlowInputSource.REQUEST, transform: "passthrough" },
      retry: { maxAttempts: 1, backoffMs: 1000 },
    },
    {
      id: "p1",
      name: "Parallel 1",
      identity: "agent2",
      dependsOn: ["start"],
      input: { source: FlowInputSource.STEP, stepId: "start", transform: "passthrough" },
      retry: { maxAttempts: 1, backoffMs: 1000 },
    },
    {
      id: "p2",
      name: "Parallel 2",
      identity: "agent3",
      dependsOn: ["start"],
      input: { source: FlowInputSource.STEP, stepId: "start", transform: "passthrough" },
      retry: { maxAttempts: 1, backoffMs: 1000 },
    },
    {
      id: "p3",
      name: "Parallel 3",
      identity: "agent4",
      dependsOn: ["start"],
      input: { source: FlowInputSource.STEP, stepId: "start", transform: "passthrough" },
      retry: { maxAttempts: 1, backoffMs: 1000 },
    },
    {
      id: "p4",
      name: "Parallel 4",
      identity: "agent5",
      dependsOn: ["start"],
      input: { source: FlowInputSource.STEP, stepId: "start", transform: "passthrough" },
      retry: { maxAttempts: 1, backoffMs: 1000 },
    },
  ];

  const flow: IFlowInput = {
    id: "parallel-limit-flow",
    name: "Parallel Limit Flow",
    description: "A flow that limits parallelism",
    version: DEFAULT_FLOW_VERSION,
    steps,
    output: { from: "p1", format: FlowOutputFormat.MARKDOWN },
    settings: { maxParallelism: 2, failFast: true },
  };

  const mockResults = {
    agent1: { thought: "Start", content: "Start result", raw: "raw start" },
    agent2: { thought: "P1", content: "P1 result", raw: "raw p1" },
    agent3: { thought: "P2", content: "P2 result", raw: "raw p2" },
    agent4: { thought: "P3", content: "P3 result", raw: "raw p3" },
    agent5: { thought: "P4", content: "P4 result", raw: "raw p4" },
  };

  const mockAgentRunner = new MockAgentRunner(mockResults);
  const mockLogger = new MockEventLogger();

  const runner = new FlowRunner({ agentExecutor: mockAgentRunner, eventLogger: mockLogger });
  const result = await runner.execute(flow as IFlow, { userPrompt: "test request" });

  assertEquals(result.stepResults.size, 5);
  assertEquals(result.success, true);
});

Deno.test("FlowRunner: generates unique flowRunId", async () => {
  const steps: IFlowStepInput[] = [
    {
      id: "step1",
      name: "Step 1",
      identity: "agent1",
      dependsOn: [],
      input: { source: FlowInputSource.REQUEST, transform: "passthrough" },
      retry: { maxAttempts: 1, backoffMs: 1000 },
    },
  ];

  const flow: IFlowInput = {
    id: "unique-id-flow",
    name: "Unique ID Flow",
    description: "A flow for testing unique IDs",
    version: DEFAULT_FLOW_VERSION,
    steps,
    output: { from: "step1", format: FlowOutputFormat.MARKDOWN },
    settings: { maxParallelism: 3, failFast: true },
  };

  const mockResults = {
    agent1: { thought: "Thinking", content: "Result", raw: "raw result" },
  };

  const mockAgentRunner = new MockAgentRunner(mockResults);
  const mockLogger = new MockEventLogger();

  const runner = new FlowRunner({ agentExecutor: mockAgentRunner, eventLogger: mockLogger });

  const result1 = await runner.execute(flow as IFlow, { userPrompt: "request 1" });
  const result2 = await runner.execute(flow as IFlow, { userPrompt: "request 2" });

  assertEquals(result1.flowRunId.length, 36);
  assertEquals(result2.flowRunId.length, 36);
  assert(result1.flowRunId !== result2.flowRunId);
});

Deno.test("FlowRunner: aggregates output from multiple steps", async () => {
  const steps: IFlowStepInput[] = [
    {
      id: "step1",
      name: "Step 1",
      identity: "agent1",
      dependsOn: [],
      input: { source: FlowInputSource.REQUEST, transform: "passthrough" },
      retry: { maxAttempts: 1, backoffMs: 1000 },
    },
    {
      id: "step2",
      name: "Step 2",
      identity: "agent2",
      dependsOn: [],
      input: { source: FlowInputSource.REQUEST, transform: "passthrough" },
      retry: { maxAttempts: 1, backoffMs: 1000 },
    },
  ];

  const flow: IFlowInput = {
    id: "aggregate-flow",
    name: "Aggregate Flow",
    description: "A flow that aggregates outputs",
    version: DEFAULT_FLOW_VERSION,
    steps,
    output: { from: ["step1", "step2"], format: FlowOutputFormat.JSON },
    settings: { maxParallelism: 3, failFast: true },
  };

  const mockResults = {
    agent1: { thought: "Step 1 thinking", content: "Result 1", raw: "raw result 1" },
    agent2: { thought: "Step 2 thinking", content: "Result 2", raw: "raw result 2" },
  };

  const mockAgentRunner = new MockAgentRunner(mockResults);
  const mockLogger = new MockEventLogger();

  const runner = new FlowRunner({ agentExecutor: mockAgentRunner, eventLogger: mockLogger });
  const result = await runner.execute(flow as IFlow, { userPrompt: "test request" });

  assertEquals(result.output, '{"step1":"Result 1","step2":"Result 2"}');
});

Deno.test("FlowRunner: handles empty flow", async () => {
  const flow: IFlowInput = {
    id: "empty-flow",
    name: "Empty Flow",
    description: "A flow with no steps",
    version: DEFAULT_FLOW_VERSION,
    steps: [],
    output: { from: [], format: FlowOutputFormat.MARKDOWN },
    settings: { maxParallelism: 3, failFast: true },
  };

  const mockAgentRunner = new MockAgentRunner();
  const mockLogger = new MockEventLogger();

  const runner = new FlowRunner({ agentExecutor: mockAgentRunner, eventLogger: mockLogger });

  try {
    await runner.execute(flow as IFlow, { userPrompt: "test request" });
    throw new Error("Expected FlowExecutionError to be thrown");
  } catch (error) {
    assert(error instanceof FlowExecutionError);
    assert(error.message.includes("Flow must have at least one step"));
  }
});

Deno.test("FlowRunner: rejects flow with cyclic fallback chain at validation", async () => {
  const steps: IFlowStepInput[] = [
    {
      id: "step-a",
      name: "Step A",
      identity: "agent-a",
      dependsOn: [],
      input: { source: FlowInputSource.REQUEST, transform: "passthrough" },
      onError: { action: FlowStepOnErrorAction.FALLBACK, fallbackStep: "step-b" },
      retry: { maxAttempts: 1, backoffMs: 1000 },
    },
    {
      id: "step-b",
      name: "Step B",
      identity: "agent-b",
      dependsOn: [],
      input: { source: FlowInputSource.REQUEST, transform: "passthrough" },
      onError: { action: FlowStepOnErrorAction.FALLBACK, fallbackStep: "step-a" },
      retry: { maxAttempts: 1, backoffMs: 1000 },
    },
  ];

  const flow: IFlowInput = {
    id: "cyclic-fallback-flow",
    name: "Cyclic Fallback Flow",
    description: "A flow with a cyclic fallback chain",
    version: DEFAULT_FLOW_VERSION,
    steps,
    output: { from: "step-a", format: FlowOutputFormat.MARKDOWN },
    settings: { maxParallelism: 3, failFast: true },
  };

  const mockAgentRunner = new MockAgentRunner({
    "agent-a": "unused",
    "agent-b": "unused",
  });
  const mockLogger = new MockEventLogger();

  const runner = new FlowRunner({ agentExecutor: mockAgentRunner, eventLogger: mockLogger });

  await assertRejects(
    async () => await runner.execute(flow as IFlow, { userPrompt: "test request" }),
    FlowExecutionError,
    "Cyclic fallback chain detected",
  );

  const validationFailedEvent = mockLogger.events.find((event) => event.event === "flow.validation.failed");
  assert(validationFailedEvent);
  assertEquals(validationFailedEvent.payload.error, "Cyclic fallback chain detected: step-a -> step-b -> step-a");
});

Deno.test("FlowRunner: accepts linear fallback chain A->B->C", async () => {
  const steps: IFlowStepInput[] = [
    {
      id: "step-a",
      name: "Step A",
      identity: "agent-a",
      dependsOn: [],
      input: { source: FlowInputSource.REQUEST, transform: "passthrough" },
      onError: { action: FlowStepOnErrorAction.FALLBACK, fallbackStep: "step-b" },
      retry: { maxAttempts: 1, backoffMs: 1000 },
    },
    {
      id: "step-b",
      name: "Step B",
      identity: "agent-b",
      dependsOn: ["step-a"],
      condition: "results['step-a']?.success !== true",
      input: { source: FlowInputSource.REQUEST, transform: "passthrough" },
      onError: { action: FlowStepOnErrorAction.FALLBACK, fallbackStep: "step-c" },
      retry: { maxAttempts: 1, backoffMs: 1000 },
    },
    {
      id: "step-c",
      name: "Step C",
      identity: "agent-c",
      dependsOn: ["step-b"],
      condition: "results['step-b']?.success !== true",
      input: { source: FlowInputSource.REQUEST, transform: "passthrough" },
      retry: { maxAttempts: 1, backoffMs: 1000 },
    },
  ];

  const flow: IFlowInput = {
    id: "linear-fallback-flow",
    name: "Linear Fallback Flow",
    description: "A flow with a linear fallback chain",
    version: DEFAULT_FLOW_VERSION,
    steps,
    output: { from: "step-a", format: FlowOutputFormat.MARKDOWN },
    settings: { maxParallelism: 3, failFast: true },
  };

  const mockAgentRunner = new SequencedMockAgentRunner({
    "agent-a": ["Primary result"],
    "agent-b": ["Unused fallback result"],
    "agent-c": ["Unused terminal fallback result"],
  });
  const mockLogger = new MockEventLogger();

  const runner = new FlowRunner({ agentExecutor: mockAgentRunner, eventLogger: mockLogger });
  const result = await runner.execute(flow as IFlow, { userPrompt: "test request" });

  assertEquals(result.success, true);
  assertEquals(result.output, "Primary result");
  assertEquals(mockAgentRunner.calls, ["agent-a"]);
});

Deno.test("FlowRunner: handles step with invalid input source", async () => {
  const steps: IFlowStepInput[] = [
    {
      id: "step1",
      name: "Step 1",
      identity: "agent1",
      dependsOn: [],
      input: { source: FlowInputSource.STEP, transform: "passthrough" }, // Missing stepId
      retry: { maxAttempts: 1, backoffMs: 1000 },
    },
  ];

  const flow: IFlowInput = {
    id: "invalid-input-flow",
    name: "Invalid Input Flow",
    description: "A flow with invalid step input",
    version: DEFAULT_FLOW_VERSION,
    steps,
    output: { from: "step1", format: FlowOutputFormat.MARKDOWN },
    settings: { maxParallelism: 3, failFast: false }, // Don't fail fast so we can check step error
  };

  const mockResults = {
    agent1: { thought: "Thinking", content: "Result", raw: "raw result" },
  };

  const mockAgentRunner = new MockAgentRunner(mockResults);
  const mockLogger = new MockEventLogger();

  const runner = new FlowRunner({ agentExecutor: mockAgentRunner, eventLogger: mockLogger });
  const result = await runner.execute(flow as IFlow, { userPrompt: "test request" });

  assertEquals(result.success, false);
  assertEquals(result.stepResults.get("step1")?.success, false);
  assert(result.stepResults.get("step1")?.error?.includes('Step step1 has source "step" but no stepId specified'));
});

Deno.test("FlowRunner: handles step depending on failed step", async () => {
  const steps: IFlowStepInput[] = [
    {
      id: "step1",
      name: "Step 1",
      identity: "failing-agent",
      dependsOn: [],
      input: { source: FlowInputSource.REQUEST, transform: "passthrough" },
      retry: { maxAttempts: 1, backoffMs: 1000 },
    },
    {
      id: "step2",
      name: "Step 2",
      identity: "agent2",
      dependsOn: ["step1"],
      input: { source: FlowInputSource.STEP, stepId: "step1", transform: "passthrough" },
      retry: { maxAttempts: 1, backoffMs: 1000 },
    },
  ];

  const flow: IFlowInput = {
    id: "failed-dependency-flow",
    name: "Failed Dependency Flow",
    description: "A flow where step depends on failed step",
    version: DEFAULT_FLOW_VERSION,
    steps,
    output: { from: "step2", format: FlowOutputFormat.MARKDOWN },
    settings: { maxParallelism: 3, failFast: false }, // Don't fail fast to test dependency handling
  };

  const mockResults = {
    agent2: { thought: "Thinking 2", content: "Result 2", raw: "raw result 2" },
  };

  const mockAgentRunner = new MockAgentRunner(mockResults, ["failing-agent"]);
  const mockLogger = new MockEventLogger();

  const runner = new FlowRunner({ agentExecutor: mockAgentRunner, eventLogger: mockLogger });
  const result = await runner.execute(flow as IFlow, { userPrompt: "test request" });

  assertEquals(result.success, false);
  assertEquals(result.stepResults.get("step1")?.success, false);
  assertEquals(result.stepResults.get("step2")?.success, false);
  assert(result.stepResults.get("step2")?.error?.includes("Step step2 depends on step1 which has no result"));
});

Deno.test("FlowRunner: handles circular dependencies", async () => {
  const steps: IFlowStepInput[] = [
    {
      id: "step1",
      name: "Step 1",
      identity: "agent1",
      dependsOn: ["step2"], // Circular dependency
      input: { source: FlowInputSource.REQUEST, transform: "passthrough" },
      retry: { maxAttempts: 1, backoffMs: 1000 },
    },
    {
      id: "step2",
      name: "Step 2",
      identity: "agent2",
      dependsOn: ["step1"], // Circular dependency
      input: { source: FlowInputSource.STEP, stepId: "step1", transform: "passthrough" },
      retry: { maxAttempts: 1, backoffMs: 1000 },
    },
  ];

  const flow: IFlowInput = {
    id: "circular-flow",
    name: "Circular Flow",
    description: "A flow with circular dependencies",
    version: DEFAULT_FLOW_VERSION,
    steps,
    output: { from: "step1", format: FlowOutputFormat.MARKDOWN },
    settings: { maxParallelism: 3, failFast: true },
  };

  const mockAgentRunner = new MockAgentRunner();
  const mockLogger = new MockEventLogger();

  const runner = new FlowRunner({ agentExecutor: mockAgentRunner, eventLogger: mockLogger });

  try {
    await runner.execute(flow as IFlow, { userPrompt: "test request" });
    console.log("No error thrown - this is unexpected");
    throw new Error("Expected an error to be thrown");
  } catch (error) {
    console.log("Error thrown:", (error as Error).constructor.name, (error as Error).message);
    assert(error instanceof FlowExecutionError || error instanceof Error);
    assert(
      (error as Error).message.includes("Cycle") || (error as Error).message.includes("Circular") ||
        (error as Error).message.includes("dependency"),
    );
  }
});

Deno.test("FlowRunner: handles agent execution throwing non-Error", async () => {
  const steps: IFlowStepInput[] = [
    {
      id: "step1",
      name: "Step 1",
      identity: "throwing-agent",
      dependsOn: [],
      input: { source: FlowInputSource.REQUEST, transform: "passthrough" },
      retry: { maxAttempts: 1, backoffMs: 1000 },
    },
  ];

  const flow: IFlowInput = {
    id: "throwing-flow",
    name: "Throwing Flow",
    description: "A flow with agent that throws non-Error",
    version: DEFAULT_FLOW_VERSION,
    steps,
    output: { from: "step1", format: FlowOutputFormat.MARKDOWN },
    settings: { maxParallelism: 3, failFast: false },
  };

  // Mock agent runner that throws a string
  class ThrowingAgentRunner extends MockAgentRunner {
    override async run(identityId: string, request: IFlowStepRequest): Promise<IAgentExecutionResult> {
      if (identityId === "throwing-agent") {
        throw "String error"; // Throw a string, not an Error
      }
      return await super.run(identityId, request);
    }
  }

  const mockAgentRunner = new ThrowingAgentRunner();
  const mockLogger = new MockEventLogger();

  const runner = new FlowRunner({ agentExecutor: mockAgentRunner, eventLogger: mockLogger });
  const result = await runner.execute(flow as IFlow, { userPrompt: "test request" });

  assertEquals(result.success, false);
  assertEquals(result.stepResults.get("step1")?.success, false);
  assertEquals(result.stepResults.get("step1")?.error, "String error");
});

Deno.test("FlowRunner: handles output aggregation with failed steps", async () => {
  const steps: IFlowStepInput[] = [
    {
      id: "step1",
      name: "Step 1",
      identity: "agent1",
      dependsOn: [],
      input: { source: FlowInputSource.REQUEST, transform: "passthrough" },
      retry: { maxAttempts: 1, backoffMs: 1000 },
    },
    {
      id: "step2",
      name: "Step 2",
      identity: "failing-agent",
      dependsOn: [],
      input: { source: FlowInputSource.REQUEST, transform: "passthrough" },
      retry: { maxAttempts: 1, backoffMs: 1000 },
    },
  ];

  const flow: IFlowInput = {
    id: "mixed-output-flow",
    name: "Mixed Output Flow",
    description: "A flow with mixed success/failure for output aggregation",
    version: DEFAULT_FLOW_VERSION,
    steps,
    output: { from: ["step1", "step2"], format: FlowOutputFormat.CONCAT },
    settings: { maxParallelism: 3, failFast: false },
  };

  const mockResults = {
    agent1: { thought: "Thinking 1", content: "Result 1", raw: "raw result 1" },
  };

  const mockAgentRunner = new MockAgentRunner(mockResults, ["failing-agent"]);
  const mockLogger = new MockEventLogger();

  const runner = new FlowRunner({ agentExecutor: mockAgentRunner, eventLogger: mockLogger });
  const result = await runner.execute(flow as IFlow, { userPrompt: "test request" });

  assertEquals(result.success, false); // Overall flow failed
  assertEquals(result.output, "Result 1"); // Only successful step included
});

Deno.test("FlowRunner: handles output aggregation with all failed steps", async () => {
  const steps: IFlowStepInput[] = [
    {
      id: "step1",
      name: "Step 1",
      identity: "failing-agent1",
      dependsOn: [],
      input: { source: FlowInputSource.REQUEST, transform: "passthrough" },
      retry: { maxAttempts: 1, backoffMs: 1000 },
    },
    {
      id: "step2",
      name: "Step 2",
      identity: "failing-agent2",
      dependsOn: [],
      input: { source: FlowInputSource.REQUEST, transform: "passthrough" },
      retry: { maxAttempts: 1, backoffMs: 1000 },
    },
  ];

  const flow: IFlowInput = {
    id: "all-failed-flow",
    name: "All Failed Flow",
    description: "A flow where all steps fail",
    version: DEFAULT_FLOW_VERSION,
    steps,
    output: { from: ["step1", "step2"], format: FlowOutputFormat.JSON },
    settings: { maxParallelism: 3, failFast: false },
  };

  const mockAgentRunner = new MockAgentRunner({}, ["failing-agent1", "failing-agent2"]);
  const mockLogger = new MockEventLogger();

  const runner = new FlowRunner({ agentExecutor: mockAgentRunner, eventLogger: mockLogger });
  const result = await runner.execute(flow as IFlow, { userPrompt: "test request" });

  assertEquals(result.success, false);
  assertEquals(result.output, "{}"); // Empty JSON object when no successful steps
});

Deno.test("FlowRunner: applies mergeAsContext transform", async () => {
  const steps: IFlowStepInput[] = [
    {
      id: "step1",
      name: "Step 1",
      identity: "test-agent",
      dependsOn: [],
      input: { source: FlowInputSource.REQUEST, transform: "mergeAsContext", transformArgs: ["Input 1", "Input 2"] },
      retry: { maxAttempts: 1, backoffMs: 1000 },
    },
  ];

  const flow: IFlowInput = {
    id: "test-flow",
    name: "Test Flow",
    description: "Test flow",
    version: DEFAULT_FLOW_VERSION,
    steps,
    output: { from: "step1", format: FlowOutputFormat.MARKDOWN },
    settings: { maxParallelism: 3, failFast: true },
  };

  const mockResults = {
    "test-agent": { thought: "Thinking", content: "Step output", raw: "raw output" },
  };

  const mockAgentRunner = new MockAgentRunner(mockResults);
  const mockLogger = new MockEventLogger();

  const runner = new FlowRunner({ agentExecutor: mockAgentRunner, eventLogger: mockLogger });
  const result = await runner.execute(flow as IFlow, { userPrompt: "ignored since transformArgs provided" });

  assertEquals(result.success, true);
  assertEquals(result.output, "Step output");
});

Deno.test("FlowRunner: applies extractSection transform", async () => {
  const flow: IFlowInput = {
    id: "test-flow",
    name: "Test Flow",
    description: "Test flow",
    version: DEFAULT_FLOW_VERSION,
    steps: [
      {
        id: "step1",
        name: "Step 1",
        identity: "test-agent",
        dependsOn: [],
        retry: { maxAttempts: 1, backoffMs: 1000 },
        input: { source: FlowInputSource.REQUEST, transform: "extractSection", transformArgs: "Requirements" },
      },
    ],
    output: { from: "step1", format: FlowOutputFormat.MARKDOWN },
    settings: { maxParallelism: 3, failFast: true },
  };

  const mockAgentRunner = new MockAgentRunner({
    "test-agent": "Extracted content",
  });
  const mockLogger = new MockEventLogger();

  const runner = new FlowRunner({ agentExecutor: mockAgentRunner, eventLogger: mockLogger });
  const result = await runner.execute(flow as IFlow, {
    userPrompt: "## Requirements\n\nThis is the requirements section\n\n## Implementation\n\nThis is implementation",
  });

  assertEquals(result.success, true);
  assertEquals(result.output, "Extracted content");
});

Deno.test("FlowRunner: applies appendToRequest transform", async () => {
  const flow: IFlowInput = {
    id: "test-flow",
    name: "Test Flow",
    description: "Test flow",
    version: DEFAULT_FLOW_VERSION,
    steps: [
      {
        id: "step1",
        name: "Step 1",
        identity: "test-agent",
        dependsOn: [],
        retry: { maxAttempts: 1, backoffMs: 1000 },
        input: { source: FlowInputSource.REQUEST, transform: "appendToRequest" },
      },
    ],
    output: { from: "step1", format: FlowOutputFormat.MARKDOWN },
    settings: { maxParallelism: 3, failFast: true },
  };

  const mockAgentRunner = new MockAgentRunner({
    "test-agent": "Transformed output",
  });
  const mockLogger = new MockEventLogger();

  const runner = new FlowRunner({ agentExecutor: mockAgentRunner, eventLogger: mockLogger });
  const result = await runner.execute(flow as IFlow, { userPrompt: "original request" });

  assertEquals(result.success, true);
  assertEquals(result.output, "Transformed output");
});

Deno.test("FlowRunner: applies jsonExtract transform", async () => {
  const flow: IFlowInput = {
    id: "test-flow",
    name: "Test Flow",
    description: "Test flow",
    version: DEFAULT_FLOW_VERSION,
    steps: [
      {
        id: "step1",
        name: "Step 1",
        identity: "test-agent",
        dependsOn: [],
        retry: { maxAttempts: 1, backoffMs: 1000 },
        input: { source: FlowInputSource.REQUEST, transform: "jsonExtract", transformArgs: "user.name" },
      },
    ],
    output: { from: "step1", format: FlowOutputFormat.MARKDOWN },
    settings: { maxParallelism: 3, failFast: true },
  };

  const mockAgentRunner = new MockAgentRunner({
    "test-agent": "Extracted value",
  });
  const mockLogger = new MockEventLogger();

  const runner = new FlowRunner({ agentExecutor: mockAgentRunner, eventLogger: mockLogger });
  const result = await runner.execute(flow as IFlow, {
    userPrompt: JSON.stringify({ user: { name: "John", age: 30 } }),
  });

  assertEquals(result.success, true);
  assertEquals(result.output, "Extracted value");
});

Deno.test("FlowRunner: applies templateFill transform", async () => {
  const flow: IFlowInput = {
    id: "test-flow",
    name: "Test Flow",
    description: "Test flow",
    version: DEFAULT_FLOW_VERSION,
    steps: [
      {
        id: "step1",
        name: "Step 1",
        identity: "test-agent",
        dependsOn: [],
        retry: { maxAttempts: 1, backoffMs: 1000 },
        input: {
          source: FlowInputSource.REQUEST,
          transform: "templateFill",
          transformArgs: { name: "Alice", task: "coding" },
        },
      },
    ],
    output: { from: "step1", format: FlowOutputFormat.MARKDOWN },
    settings: { maxParallelism: 3, failFast: true },
  };

  const mockAgentRunner = new MockAgentRunner({
    "test-agent": "Filled template",
  });
  const mockLogger = new MockEventLogger();

  const runner = new FlowRunner({ agentExecutor: mockAgentRunner, eventLogger: mockLogger });
  const result = await runner.execute(flow as IFlow, {
    userPrompt: "Hello {{name}}, your task is {{task}}",
  });

  assertEquals(result.success, true);
  assertEquals(result.output, "Filled template");
});

Deno.test("FlowRunner: applies custom transform function", async () => {
  const customTransform = (input: string) => `CUSTOM: ${input.toUpperCase()}`;

  const flow: IFlowInput = {
    id: "test-flow",
    name: "Test Flow",
    description: "Test flow",
    version: DEFAULT_FLOW_VERSION,
    steps: [
      {
        id: "step1",
        name: "Step 1",
        identity: "test-agent",
        dependsOn: [],
        retry: { maxAttempts: 1, backoffMs: 1000 },
        input: { source: FlowInputSource.REQUEST, transform: customTransform },
      },
    ],
    output: { from: "step1", format: FlowOutputFormat.MARKDOWN },
    settings: { maxParallelism: 3, failFast: true },
  };

  const mockAgentRunner = new MockAgentRunner({
    "test-agent": "Custom transformed",
  });
  const mockLogger = new MockEventLogger();

  const runner = new FlowRunner({ agentExecutor: mockAgentRunner, eventLogger: mockLogger });
  const result = await runner.execute(flow as IFlow, { userPrompt: "test input" });

  assertEquals(result.success, true);
  assertEquals(result.output, "Custom transformed");
});

Deno.test("FlowRunner: handles unknown transform", async () => {
  const flow: IFlowInput = {
    id: "test-flow",
    name: "Test Flow",
    description: "Test flow",
    version: DEFAULT_FLOW_VERSION,
    steps: [
      {
        id: "step1",
        name: "Step 1",
        identity: "test-agent",
        dependsOn: [],
        retry: { maxAttempts: 1, backoffMs: 1000 },
        input: { source: FlowInputSource.REQUEST, transform: "unknownTransform" },
      },
    ],
    output: { from: "step1", format: FlowOutputFormat.MARKDOWN },
    settings: { maxParallelism: 3, failFast: true },
  };

  const mockAgentRunner = new MockAgentRunner({
    "test-agent": "Should not reach here",
  });
  const mockLogger = new MockEventLogger();

  const runner = new FlowRunner({ agentExecutor: mockAgentRunner, eventLogger: mockLogger });

  try {
    await runner.execute(flow as IFlow, { userPrompt: "test" });
    throw new Error("Expected FlowExecutionError to be thrown");
  } catch (error) {
    assert(error instanceof FlowExecutionError);
    assert((error as Error).message.includes("Unknown transform: unknownTransform"));
  }
});

Deno.test("FlowRunner: handles transform function throwing error", async () => {
  const failingTransform = () => {
    throw new Error("Transform failed");
  };

  const flow: IFlowInput = {
    id: "test-flow",
    name: "Test Flow",
    description: "Test flow",
    version: DEFAULT_FLOW_VERSION,
    steps: [
      {
        id: "step1",
        name: "Step 1",
        identity: "test-agent",
        dependsOn: [],
        retry: { maxAttempts: 1, backoffMs: 1000 },
        input: { source: FlowInputSource.REQUEST, transform: failingTransform },
      },
    ],
    output: { from: "step1", format: FlowOutputFormat.MARKDOWN },
    settings: { maxParallelism: 3, failFast: true },
  };

  const mockAgentRunner = new MockAgentRunner({
    "test-agent": "Should not reach here",
  });
  const mockLogger = new MockEventLogger();

  const runner = new FlowRunner({ agentExecutor: mockAgentRunner, eventLogger: mockLogger });

  try {
    await runner.execute(flow as IFlow, { userPrompt: "test" });
    throw new Error("Expected FlowExecutionError to be thrown");
  } catch (error) {
    assert(error instanceof FlowExecutionError);
    assert((error as Error).message.includes("Custom transform failed: Transform failed"));
  }
});

Deno.test("FlowRunner: handles invalid transform args for extractSection", async () => {
  const flow: IFlowInput = {
    id: "test-flow",
    name: "Test Flow",
    description: "Test flow",
    version: DEFAULT_FLOW_VERSION,
    steps: [
      {
        id: "step1",
        name: "Step 1",
        identity: "test-agent",
        dependsOn: [],
        retry: { maxAttempts: 1, backoffMs: 1000 },
        input: { source: FlowInputSource.REQUEST, transform: "extractSection" }, // Missing transformArgs
      },
    ],
    output: { from: "step1", format: FlowOutputFormat.MARKDOWN },
    settings: { maxParallelism: 3, failFast: true },
  };

  const mockAgentRunner = new MockAgentRunner({
    "test-agent": "Should not reach here",
  });
  const mockLogger = new MockEventLogger();

  const runner = new FlowRunner({ agentExecutor: mockAgentRunner, eventLogger: mockLogger });

  try {
    await runner.execute(flow as IFlow, { userPrompt: "test" });
    throw new Error("Expected FlowExecutionError to be thrown");
  } catch (error) {
    assert(error instanceof FlowExecutionError);
    assert((error as Error).message.includes("extractSection requires a section name as transformArgs"));
  }
});

Deno.test("FlowRunner: handles invalid transform args for jsonExtract", async () => {
  const flow: IFlowInput = {
    id: "test-flow",
    name: "Test Flow",
    description: "Test flow",
    version: DEFAULT_FLOW_VERSION,
    steps: [
      {
        id: "step1",
        name: "Step 1",
        identity: "test-agent",
        dependsOn: [],
        retry: { maxAttempts: 1, backoffMs: 1000 },
        input: { source: FlowInputSource.REQUEST, transform: "jsonExtract" }, // Missing transformArgs
      },
    ],
    output: { from: "step1", format: FlowOutputFormat.MARKDOWN },
    settings: { maxParallelism: 3, failFast: true },
  };

  const mockAgentRunner = new MockAgentRunner({
    "test-agent": "Should not reach here",
  });
  const mockLogger = new MockEventLogger();

  const runner = new FlowRunner({ agentExecutor: mockAgentRunner, eventLogger: mockLogger });

  try {
    await runner.execute(flow as IFlow, { userPrompt: "test" });
    throw new Error("Expected FlowExecutionError to be thrown");
  } catch (error) {
    assert(error instanceof FlowExecutionError);
    assert((error as Error).message.includes("jsonExtract requires a field path as transformArgs"));
  }
});

Deno.test("FlowRunner: handles invalid transform args for templateFill", async () => {
  const flow: IFlowInput = {
    id: "test-flow",
    name: "Test Flow",
    description: "Test flow",
    version: DEFAULT_FLOW_VERSION,
    steps: [
      {
        id: "step1",
        name: "Step 1",
        identity: "test-agent",
        dependsOn: [],
        retry: { maxAttempts: 1, backoffMs: 1000 },
        input: { source: FlowInputSource.REQUEST, transform: "templateFill", transformArgs: "not-an-object" },
      },
    ],
    output: { from: "step1", format: FlowOutputFormat.MARKDOWN },
    settings: { maxParallelism: 3, failFast: true },
  };

  const mockAgentRunner = new MockAgentRunner({
    "test-agent": "Should not reach here",
  });
  const mockLogger = new MockEventLogger();

  const runner = new FlowRunner({ agentExecutor: mockAgentRunner, eventLogger: mockLogger });

  await assertRejects(
    async () => await runner.execute(flow as IFlow, { userPrompt: "test" }),
    FlowExecutionError,
    "templateFill requires a context object as transformArgs",
  );
});

Deno.test("FlowRunner: handles agent execution throwing error in Promise.allSettled", async () => {
  const flow: IFlowInput = {
    id: "test-flow",
    name: "Test Flow",
    description: "Test flow",
    version: DEFAULT_FLOW_VERSION,
    steps: [
      {
        id: "step1",
        name: "Step 1",
        identity: "throwing-agent",
        dependsOn: [],
        retry: { maxAttempts: 1, backoffMs: 1000 },
        input: { source: FlowInputSource.REQUEST, transform: "passthrough" },
      },
    ],
    output: { from: "step1", format: FlowOutputFormat.MARKDOWN },
    settings: { maxParallelism: 3, failFast: false },
  };

  const mockAgentRunner = new MockAgentRunner({}, ["throwing-agent"]);
  const mockLogger = new MockEventLogger();

  const runner = new FlowRunner({ agentExecutor: mockAgentRunner, eventLogger: mockLogger });
  const result = await runner.execute(flow as IFlow, { userPrompt: "test request" });

  assertEquals(result.success, false);
  assert(result.stepResults.get("step1")?.error?.includes("Mock failure"));
});

Deno.test("FlowRunner: handles aggregate output with concat format", async () => {
  const flow: IFlowInput = {
    id: "test-flow",
    name: "Test Flow",
    description: "Test flow",
    version: DEFAULT_FLOW_VERSION,
    steps: [
      {
        id: "step1",
        name: "Step 1",
        identity: "test-agent1",
        dependsOn: [],
        retry: { maxAttempts: 1, backoffMs: 1000 },
        input: { source: FlowInputSource.REQUEST, transform: "passthrough" },
      },
      {
        id: "step2",
        name: "Step 2",
        identity: "test-agent2",
        dependsOn: [],
        retry: { maxAttempts: 1, backoffMs: 1000 },
        input: { source: FlowInputSource.REQUEST, transform: "passthrough" },
      },
    ],
    output: { from: ["step1", "step2"], format: FlowOutputFormat.CONCAT },
    settings: { maxParallelism: 3, failFast: true },
  };

  const mockAgentRunner = new MockAgentRunner({
    "test-agent1": "Output 1",
    "test-agent2": "Output 2",
  });
  const mockLogger = new MockEventLogger();

  const runner = new FlowRunner({ agentExecutor: mockAgentRunner, eventLogger: mockLogger });
  const result = await runner.execute(flow as IFlow, { userPrompt: "test request" });

  assertEquals(result.success, true);
  assertEquals(result.output, "Output 1\nOutput 2");
});

// Condition evaluation tests (Phase 15.1)
Deno.test("FlowRunner: executes step when condition evaluates to true", async () => {
  const steps: IFlowStepInput[] = [
    {
      id: "step1",
      name: "Step 1",
      identity: "agent1",
      dependsOn: [],
      input: { source: FlowInputSource.REQUEST, transform: "passthrough" },
      retry: { maxAttempts: 1, backoffMs: 1000 },
    },
    {
      id: "step2",
      name: "Step 2",
      identity: "agent2",
      dependsOn: ["step1"],
      condition: "results['step1'].success === true",
      input: { source: FlowInputSource.STEP, stepId: "step1", transform: "passthrough" },
      retry: { maxAttempts: 1, backoffMs: 1000 },
    },
  ];

  const flow: IFlowInput = {
    id: "test-flow",
    name: "Test Flow",
    description: "Flow with conditions",
    version: DEFAULT_FLOW_VERSION,
    steps,
    output: { from: "step2", format: FlowOutputFormat.MARKDOWN },
    settings: { maxParallelism: 3, failFast: true },
  };

  const mockAgentRunner = new MockAgentRunner({
    agent1: "Step 1 result",
    agent2: "Step 2 result",
  });
  const mockLogger = new MockEventLogger();

  const runner = new FlowRunner({ agentExecutor: mockAgentRunner, eventLogger: mockLogger });
  const result = await runner.execute(flow as IFlow, { userPrompt: "test request" });

  assertEquals(result.success, true);
  assertEquals(result.stepResults.get("step1")?.success, true);
  assertEquals(result.stepResults.get("step2")?.success, true);
  assertEquals(result.stepResults.get("step2")?.skipped, undefined);
  assertEquals(result.output, "Step 2 result");

  // Should have condition.evaluated event
  const conditionEvent = mockLogger.events.find((e) => e.event === "flow.step.condition.evaluated");
  assert(conditionEvent);
  assertEquals(conditionEvent.payload.stepId, "step2");
  assertEquals(conditionEvent.payload.shouldExecute, true);
});

Deno.test("FlowRunner: skips step when condition evaluates to false", async () => {
  const steps: IFlowStepInput[] = [
    {
      id: "step1",
      name: "Step 1",
      identity: "agent1",
      dependsOn: [],
      input: { source: FlowInputSource.REQUEST, transform: "passthrough" },
      retry: { maxAttempts: 1, backoffMs: 1000 },
    },
    {
      id: "step2",
      name: "Step 2 (will be skipped)",
      identity: "agent2",
      dependsOn: ["step1"],
      condition: "results['step1'].success === false", // Will be false since step1 succeeds
      input: { source: FlowInputSource.STEP, stepId: "step1", transform: "passthrough" },
      retry: { maxAttempts: 1, backoffMs: 1000 },
    },
    {
      id: "step3",
      name: "Step 3",
      identity: "agent3",
      dependsOn: ["step1"],
      input: { source: FlowInputSource.STEP, stepId: "step1", transform: "passthrough" },
      retry: { maxAttempts: 1, backoffMs: 1000 },
    },
  ];

  const flow: IFlowInput = {
    id: "test-flow",
    name: "Test Flow",
    description: "Flow with skipped step",
    version: DEFAULT_FLOW_VERSION,
    steps,
    output: { from: "step3", format: FlowOutputFormat.MARKDOWN },
    settings: { maxParallelism: 3, failFast: true },
  };

  const mockAgentRunner = new MockAgentRunner({
    agent1: "Step 1 result",
    agent2: "Step 2 result", // Won't be used since condition is false
    agent3: "Step 3 result",
  });
  const mockLogger = new MockEventLogger();

  const runner = new FlowRunner({ agentExecutor: mockAgentRunner, eventLogger: mockLogger });
  const result = await runner.execute(flow as IFlow, { userPrompt: "test request" });

  assertEquals(result.success, true);
  assertEquals(result.stepResults.get("step1")?.success, true);
  assertEquals(result.stepResults.get("step2")?.success, true); // Skipped counts as success
  assertEquals(result.stepResults.get("step2")?.skipped, true);
  assertEquals(result.stepResults.get("step2")?.result, undefined); // No result for skipped
  assertEquals(result.stepResults.get("step3")?.success, true);
  assertEquals(result.output, "Step 3 result");

  // Should have step.skipped event
  const skippedEvent = mockLogger.events.find((e) => e.event === "flow.step.skipped");
  assert(skippedEvent);
  assertEquals(skippedEvent.payload.stepId, "step2");
});

Deno.test("FlowRunner: handles complex conditions with multiple results", async () => {
  const steps: IFlowStepInput[] = [
    {
      id: "analyze",
      name: "Analyze",
      identity: "analyzer",
      dependsOn: [],
      input: { source: FlowInputSource.REQUEST, transform: "passthrough" },
      retry: { maxAttempts: 1, backoffMs: 1000 },
    },
    {
      id: "review",
      name: "Review",
      identity: "reviewer",
      dependsOn: [],
      input: { source: FlowInputSource.REQUEST, transform: "passthrough" },
      retry: { maxAttempts: 1, backoffMs: 1000 },
    },
    {
      id: "final",
      name: "Final",
      identity: "finalizer",
      dependsOn: ["analyze", "review"],
      condition: "results['analyze'].success && results['review'].success",
      input: { source: FlowInputSource.AGGREGATE, from: ["analyze", "review"], transform: "mergeAsContext" },
      retry: { maxAttempts: 1, backoffMs: 1000 },
    },
  ];

  const flow: IFlowInput = {
    id: "test-flow",
    name: "Test Flow",
    description: "Flow with complex conditions",
    version: DEFAULT_FLOW_VERSION,
    steps,
    output: { from: "final", format: FlowOutputFormat.MARKDOWN },
    settings: { maxParallelism: 3, failFast: false },
  };

  const mockAgentRunner = new MockAgentRunner({
    analyzer: "Analysis complete",
    reviewer: "Review complete",
    finalizer: "Final synthesis",
  });
  const mockLogger = new MockEventLogger();

  const runner = new FlowRunner({ agentExecutor: mockAgentRunner, eventLogger: mockLogger });
  const result = await runner.execute(flow as IFlow, { userPrompt: "test request" });

  assertEquals(result.success, true);
  assertEquals(result.stepResults.get("final")?.success, true);
  assertEquals(result.stepResults.get("final")?.skipped, undefined);
  assertEquals(result.output, "Final synthesis");
});

Deno.test("FlowRunner: handles condition syntax errors gracefully", async () => {
  const steps: IFlowStepInput[] = [
    {
      id: "step1",
      name: "Step 1",
      identity: "agent1",
      dependsOn: [],
      input: { source: FlowInputSource.REQUEST, transform: "passthrough" },
      retry: { maxAttempts: 1, backoffMs: 1000 },
    },
    {
      id: "step2",
      name: "Step 2",
      identity: "agent2",
      dependsOn: ["step1"],
      condition: "invalid {{{ syntax", // Invalid JS
      input: { source: FlowInputSource.STEP, stepId: "step1", transform: "passthrough" },
      retry: { maxAttempts: 1, backoffMs: 1000 },
    },
  ];

  const flow: IFlowInput = {
    id: "test-flow",
    name: "Test Flow",
    description: "Flow with invalid condition",
    version: DEFAULT_FLOW_VERSION,
    steps,
    output: { from: "step2", format: FlowOutputFormat.MARKDOWN },
    settings: { maxParallelism: 3, failFast: true },
  };

  const mockAgentRunner = new MockAgentRunner({
    agent1: "Step 1 result",
    agent2: "Step 2 result",
  });
  const mockLogger = new MockEventLogger();

  const runner = new FlowRunner({ agentExecutor: mockAgentRunner, eventLogger: mockLogger });
  const result = await runner.execute(flow as IFlow, { userPrompt: "test request" });

  // Step with invalid condition should be skipped (error counts as false)
  assertEquals(result.success, true);
  assertEquals(result.stepResults.get("step1")?.success, true);
  assertEquals(result.stepResults.get("step2")?.skipped, true);
  assert(result.stepResults.get("step2")?.skipReason?.includes("Unexpected token"));
});

// ============================================================================
// Phase 17: Flow Skills Integration Tests
// ============================================================================

// Mock AgentRunner that captures requests to verify skills are passed
class CapturingMockAgentRunner implements IAgentExecutor {
  capturedRequests: Array<{ identityId: string; request: IFlowStepRequest }> = [];

  async run(identityId: string, request: IFlowStepRequest): Promise<IAgentExecutionResult> {
    this.capturedRequests.push({ identityId, request });
    return await Promise.resolve({
      thought: `Processing ${identityId}`,
      content: `Result from ${identityId}`,
      raw: `Raw from ${identityId}`,
    });
  }
}

Deno.test("FlowRunner: passes step-level skills to agent executor", async () => {
  const steps: IFlowStepInput[] = [
    {
      id: "step1",
      name: "Step 1",
      identity: "agent1",
      dependsOn: [],
      input: { source: FlowInputSource.REQUEST, transform: "passthrough" },
      skills: ["code-review", "testing"],
    },
  ];

  const flow: IFlowInput = {
    id: "test-flow",
    name: "Test Flow",
    description: "Flow with step skills",
    version: DEFAULT_FLOW_VERSION,
    steps,
    output: { from: "step1", format: FlowOutputFormat.MARKDOWN },
    settings: { maxParallelism: 3, failFast: true },
  };

  const mockAgentRunner = new CapturingMockAgentRunner();
  const mockLogger = new MockEventLogger();

  const runner = new FlowRunner({ agentExecutor: mockAgentRunner, eventLogger: mockLogger });
  await runner.execute(flow as IFlow, { userPrompt: "test request" });

  // Verify skills were passed to the agent executor
  assertEquals(mockAgentRunner.capturedRequests.length, 1);
  assertEquals(mockAgentRunner.capturedRequests[0].request.skills, ["code-review", "testing"]);
});

Deno.test("FlowRunner: passes flow-level defaultSkills when step has no skills", async () => {
  const steps: IFlowStepInput[] = [
    {
      id: "step1",
      name: "Step 1",
      identity: "agent1",
      dependsOn: [],
      input: { source: FlowInputSource.REQUEST, transform: "passthrough" },
      // No step-level skills
    },
  ];

  const flow: IFlowInput = {
    id: "test-flow",
    name: "Test Flow",
    description: "Flow with default skills",
    version: DEFAULT_FLOW_VERSION,
    steps,
    output: { from: "step1", format: FlowOutputFormat.MARKDOWN },
    settings: { maxParallelism: 3, failFast: true },
    defaultSkills: ["architecture", "documentation"],
  };

  const mockAgentRunner = new CapturingMockAgentRunner();
  const mockLogger = new MockEventLogger();

  const runner = new FlowRunner({ agentExecutor: mockAgentRunner, eventLogger: mockLogger });
  await runner.execute(flow as IFlow, { userPrompt: "test request" });

  // Verify default skills were passed to the agent executor
  assertEquals(mockAgentRunner.capturedRequests.length, 1);
  assertEquals(mockAgentRunner.capturedRequests[0].request.skills, ["architecture", "documentation"]);
});

Deno.test("FlowRunner: step-level skills override flow-level defaults", async () => {
  const steps: IFlowStepInput[] = [
    {
      id: "step1",
      name: "Step 1",
      identity: "agent1",
      dependsOn: [],
      input: { source: FlowInputSource.REQUEST, transform: "passthrough" },
      skills: ["specific-skill"], // Step-level override
    },
  ];

  const flow: IFlowInput = {
    id: "test-flow",
    name: "Test Flow",
    description: "Flow with both default and step skills",
    version: DEFAULT_FLOW_VERSION,
    steps,
    output: { from: "step1", format: FlowOutputFormat.MARKDOWN },
    settings: { maxParallelism: 3, failFast: true },
    defaultSkills: ["default-skill"], // Should be overridden
  };

  const mockAgentRunner = new CapturingMockAgentRunner();
  const mockLogger = new MockEventLogger();

  const runner = new FlowRunner({ agentExecutor: mockAgentRunner, eventLogger: mockLogger });
  await runner.execute(flow as IFlow, { userPrompt: "test request" });

  // Step skills should override flow defaults
  assertEquals(mockAgentRunner.capturedRequests.length, 1);
  assertEquals(mockAgentRunner.capturedRequests[0].request.skills, ["specific-skill"]);
});

Deno.test("FlowRunner: multi-step flow with mixed skills", async () => {
  const steps: IFlowStepInput[] = [
    {
      id: "step1",
      name: "Step 1",
      identity: "agent1",
      dependsOn: [],
      input: { source: FlowInputSource.REQUEST, transform: "passthrough" },
      // Uses flow defaults
    },
    {
      id: "step2",
      name: "Step 2",
      identity: "agent2",
      dependsOn: ["step1"],
      input: { source: FlowInputSource.STEP, stepId: "step1", transform: "passthrough" },
      skills: ["custom-skill"], // Override
    },
    {
      id: "step3",
      name: "Step 3",
      identity: "agent3",
      dependsOn: ["step2"],
      input: { source: FlowInputSource.STEP, stepId: "step2", transform: "passthrough" },
      // Uses flow defaults
    },
  ];

  const flow: IFlowInput = {
    id: "test-flow",
    name: "Test Flow",
    description: "Multi-step flow with mixed skills",
    version: DEFAULT_FLOW_VERSION,
    steps,
    output: { from: "step3", format: FlowOutputFormat.MARKDOWN },
    settings: { maxParallelism: 3, failFast: true },
    defaultSkills: ["flow-default"],
  };

  const mockAgentRunner = new CapturingMockAgentRunner();
  const mockLogger = new MockEventLogger();

  const runner = new FlowRunner({ agentExecutor: mockAgentRunner, eventLogger: mockLogger });
  await runner.execute(flow as IFlow, { userPrompt: "test request" });

  // Step1: uses flow defaults
  assertEquals(mockAgentRunner.capturedRequests[0].identityId, "agent1");
  assertEquals(mockAgentRunner.capturedRequests[0].request.skills, ["flow-default"]);

  // Step2: uses its own skills (override)
  assertEquals(mockAgentRunner.capturedRequests[1].identityId, "agent2");
  assertEquals(mockAgentRunner.capturedRequests[1].request.skills, ["custom-skill"]);

  // Step3: uses flow defaults
  assertEquals(mockAgentRunner.capturedRequests[2].identityId, "agent3");
  assertEquals(mockAgentRunner.capturedRequests[2].request.skills, ["flow-default"]);
});

Deno.test("FlowRunner: flow without any skills passes undefined", async () => {
  const steps: IFlowStepInput[] = [
    {
      id: "step1",
      name: "Step 1",
      identity: "agent1",
      dependsOn: [],
      input: { source: FlowInputSource.REQUEST, transform: "passthrough" },
    },
  ];

  const flow: IFlowInput = {
    id: "test-flow",
    name: "Test Flow",
    description: "Flow without skills",
    version: DEFAULT_FLOW_VERSION,
    steps,
    output: { from: "step1", format: FlowOutputFormat.MARKDOWN },
    settings: { maxParallelism: 3, failFast: true },
    // No defaultSkills
  };

  const mockAgentRunner = new CapturingMockAgentRunner();
  const mockLogger = new MockEventLogger();

  const runner = new FlowRunner({ agentExecutor: mockAgentRunner, eventLogger: mockLogger });
  await runner.execute(flow as IFlow, { userPrompt: "test request" });

  // Should have undefined skills
  assertEquals(mockAgentRunner.capturedRequests.length, 1);
  assertEquals(mockAgentRunner.capturedRequests[0].request.skills, undefined);
});

Deno.test("FlowRunner: logs hasSkills in input.prepared event", async () => {
  const steps: IFlowStepInput[] = [
    {
      id: "step1",
      name: "Step 1",
      identity: "agent1",
      dependsOn: [],
      input: { source: FlowInputSource.REQUEST, transform: "passthrough" },
      skills: ["test-skill"],
    },
  ];

  const flow: IFlowInput = {
    id: "test-flow",
    name: "Test Flow",
    description: "Flow for logging test",
    version: DEFAULT_FLOW_VERSION,
    steps,
    output: { from: "step1", format: FlowOutputFormat.MARKDOWN },
    settings: { maxParallelism: 3, failFast: true },
  };

  const mockAgentRunner = new CapturingMockAgentRunner();
  const mockLogger = new MockEventLogger();

  const runner = new FlowRunner({ agentExecutor: mockAgentRunner, eventLogger: mockLogger });
  await runner.execute(flow as IFlow, { userPrompt: "test request" });

  // Find the input.prepared event
  const inputPreparedEvent = mockLogger.events.find((e) => e.event === "flow.step.input.prepared");
  assert(inputPreparedEvent, "Should log flow.step.input.prepared event");
  assertEquals(inputPreparedEvent.payload.hasSkills, true);
});

// Mock DatabaseService for testing token aggregation
class MockDatabaseService {
  private activities: Array<ActivityRecord> = [];
  private readonly queryResponses: Array<ActivityRecord[]>;
  queryCallCount = 0;

  constructor(
    activities: Array<{ traceId: string; actionType: string; payload: Record<string, JSONValue> }> = [],
    queryResponses: Array<Array<{ traceId: string; actionType: string; payload: Record<string, JSONValue> }>> = [],
  ) {
    this.activities = MockDatabaseService.toActivityRecords(activities);
    this.queryResponses = queryResponses.map((response) => MockDatabaseService.toActivityRecords(response));
  }

  queryActivity(filter: IJournalFilterOptions): Promise<ActivityRecord[]> {
    this.queryCallCount++;
    const responseIndex = this.queryCallCount - 1;
    const source = this.queryResponses[responseIndex] ?? this.activities;
    return Promise.resolve(source.filter((a) => {
      if (filter.traceId && a.trace_id !== filter.traceId) return false;
      if (filter.actionType && a.action_type !== filter.actionType) return false;
      return true;
    }));
  }

  private static toActivityRecords(
    activities: Array<{ traceId: string; actionType: string; payload: Record<string, JSONValue> }>,
  ): Array<ActivityRecord> {
    return activities.map((a) => ({
      id: crypto.randomUUID(),
      trace_id: a.traceId,
      action_type: a.actionType,
      payload: JSON.stringify(a.payload),
      timestamp: new Date().toISOString(),
      actor: "test",
      actor_type: null,
      identity_id: null,
      agent_kind: null,
      target: null,
    }));
  }

  // Stubbed methods
  logActivity(
    _actor: string,
    _actionType: string,
    _target: string | null,
    _payload: Record<string, JSONValue>,
    _traceId?: string,
    _actorType?: string | null,
    _identityId?: string | null,
    _agentKind?: string | null,
  ): void {}
  waitForFlush(): Promise<void> {
    return Promise.resolve();
  }
  close(): Promise<void> {
    return Promise.resolve();
  }
  preparedGet<T>(_query: string, _params?: SqliteParam[]): Promise<T | null> {
    return Promise.resolve(null);
  }
  preparedAll<T>(_query: string, _params?: SqliteParam[]): Promise<T[]> {
    return Promise.resolve([]);
  }
  preparedRun(_query: string, _params?: SqliteParam[]): Promise<unknown> {
    return Promise.resolve(null);
  }
  getActivitiesByTrace(_traceId: string): ActivityRecord[] {
    return [];
  }
  getActivitiesByTraceSafe(_traceId: string): Promise<ActivityRecord[]> {
    return Promise.resolve([]);
  }
  getActivitiesByActionType(_actionType: string): ActivityRecord[] {
    return [];
  }
  getActivitiesByActionTypeSafe(_actionType: string): Promise<ActivityRecord[]> {
    return Promise.resolve([]);
  }
  getRecentActivity(_limit?: number): Promise<ActivityRecord[]> {
    return Promise.resolve([]);
  }
}

Deno.test("[regression] FlowRunner: aggregates token usage across flow execution", async () => {
  const mockAgentRunner = new MockAgentRunner({
    "agent1": "Step 1 result",
    "agent2": "Step 2 result",
  });

  const mockLogger = new MockEventLogger();

  // Mock database with token usage events
  const mockDb = new MockDatabaseService([
    {
      traceId: "test-trace-123",
      actionType: "llm.usage",
      payload: {
        provider: PROVIDER_OPENAI,
        input_tokens: 100,
        output_tokens: 50,
        cost_usd: 0.0025,
      },
    },
    {
      traceId: "test-trace-123",
      actionType: "llm.usage",
      payload: {
        provider: PROVIDER_OPENAI,
        input_tokens: 200,
        output_tokens: 75,
        cost_usd: 0.0050,
      },
    },
    {
      traceId: "test-trace-123",
      actionType: "llm.usage",
      payload: {
        provider: PROVIDER_ANTHROPIC,
        input_tokens: 150,
        output_tokens: 60,
        cost_usd: 0.0030,
      },
    },
  ]);

  const runner = new FlowRunner({
    agentExecutor: mockAgentRunner,
    eventLogger: mockLogger,
    db: mockDb,
  });

  const flow: IFlowInput = {
    id: "test-flow",
    name: "Test Flow",
    description: "A test flow for token aggregation",
    version: DEFAULT_FLOW_VERSION,
    steps: [
      {
        id: "step1",
        name: "Step 1",
        identity: "agent1",
        dependsOn: [],
        input: { source: FlowInputSource.REQUEST, transform: "passthrough" },
        retry: { maxAttempts: 1, backoffMs: 1000 },
      },
      {
        id: "step2",
        name: "Step 2",
        identity: "agent2",
        dependsOn: ["step1"],
        input: { source: FlowInputSource.STEP, stepId: "step1", transform: "passthrough" },
        retry: { maxAttempts: 1, backoffMs: 1000 },
      },
    ],
    output: { from: "step2", format: FlowOutputFormat.MARKDOWN },
    settings: { maxParallelism: 3, failFast: true },
  };

  await runner.execute(flow as IFlow, { userPrompt: "test request", traceId: "test-trace-123" });

  // Find the token summary event
  const tokenSummaryEvent = mockLogger.events.find((e) => e.event === "flow.token_summary");
  assert(tokenSummaryEvent, "Should log flow.token_summary event");

  const summary = tokenSummaryEvent.payload as Partial<TokenSummary> as TokenSummary;
  assertEquals(summary.totalLlmCalls, 3);
  assertEquals(summary.totalInputTokens, 450);
  assertEquals(summary.totalOutputTokens, 185);
  assertEquals(summary.totalTokens, 635);
  assertEquals(summary.totalCostUsd, 0.0105);
  assertEquals(summary.providers[PROVIDER_OPENAI].calls, 2);
  assertEquals(summary.providers[PROVIDER_OPENAI].inputTokens, 300);
  assertEquals(summary.providers[PROVIDER_OPENAI].outputTokens, 125);
  assertEquals(summary.providers[PROVIDER_OPENAI].costUsd, 0.0075);
  assertEquals(summary.providers[PROVIDER_ANTHROPIC].calls, 1);
  assertEquals(summary.providers[PROVIDER_ANTHROPIC].inputTokens, 150);
  assertEquals(summary.providers[PROVIDER_ANTHROPIC].outputTokens, 60);
  assertEquals(summary.providers[PROVIDER_ANTHROPIC].costUsd, 0.0030);
});

Deno.test("[regression] FlowRunner: handles zero token usage gracefully", async () => {
  const mockAgentRunner = new MockAgentRunner({
    "agent1": "Step 1 result",
  });

  const mockLogger = new MockEventLogger();

  // Mock database with no token usage events
  const mockDb = new MockDatabaseService([]);

  const runner = new FlowRunner({
    agentExecutor: mockAgentRunner,
    eventLogger: mockLogger,
    db: mockDb,
  });

  const flow: IFlowInput = {
    id: "test-flow",
    name: "Test Flow",
    description: "A test flow for zero token usage",
    version: DEFAULT_FLOW_VERSION,
    steps: [
      {
        id: "step1",
        name: "Step 1",
        identity: "agent1",
        dependsOn: [],
        input: { source: FlowInputSource.REQUEST, transform: "passthrough" },
        retry: { maxAttempts: 1, backoffMs: 1000 },
      },
    ],
    output: { from: "step1", format: FlowOutputFormat.MARKDOWN },
    settings: { maxParallelism: 3, failFast: true },
  };

  await runner.execute(flow as IFlow, { userPrompt: "test request", traceId: "test-trace-456" });

  // Find the token summary event
  const tokenSummaryEvent = mockLogger.events.find((e) => e.event === "flow.token_summary");
  assert(tokenSummaryEvent, "Should log flow.token_summary event");

  const summary = tokenSummaryEvent.payload as Partial<TokenSummary> as TokenSummary;
  assertEquals(summary.totalLlmCalls, 0);
  assertEquals(summary.totalInputTokens, 0);
  assertEquals(summary.totalOutputTokens, 0);
  assertEquals(summary.totalTokens, 0);
  assertEquals(summary.totalCostUsd, 0);
  assertEquals(Object.keys(summary.providers).length, 0);
});

Deno.test("FlowRunner: retry aborts when cost budget is exceeded", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "flow-runner-retry-budget-" });
  const previousTestMode = Deno.env.get("DENO_TEST");

  try {
    const steps: IFlowStepInput[] = [
      {
        id: "step1",
        name: "Retrying Step",
        identity: "flaky-agent",
        dependsOn: [],
        input: { source: FlowInputSource.REQUEST, transform: "passthrough" },
        onError: { action: FlowStepOnErrorAction.RETRY, maxRetries: 2, backoffMs: 250 },
        retry: { maxAttempts: 1, backoffMs: 1000 },
      },
    ];

    const flow: IFlowInput = {
      id: "retry-budget-flow",
      name: "Retry Budget Flow",
      description: "Aborts retries once cumulative cost exceeds the configured budget",
      version: DEFAULT_FLOW_VERSION,
      steps,
      output: { from: "step1", format: FlowOutputFormat.MARKDOWN },
      settings: { maxParallelism: 3, failFast: true },
    };

    const mockAgentRunner = new SequencedMockAgentRunner({
      "flaky-agent": [
        new Error("temporary failure 1"),
        new Error("temporary failure 2"),
        "Recovered result",
      ],
    });
    const mockLogger = new MockEventLogger();
    const mockDb = new MockDatabaseService(
      [],
      [
        [{ traceId: "test-trace-budget", actionType: "llm.usage", payload: { cost_usd: 0.002 } }],
        [{ traceId: "test-trace-budget", actionType: "llm.usage", payload: { cost_usd: 0.006 } }],
      ],
    );
    const config = {
      ...createMockConfig(tempDir),
      max_flow_retry_cost_usd: 0.005,
    } as Config;

    const runner = new FlowRunner({
      agentExecutor: mockAgentRunner,
      eventLogger: mockLogger,
      db: mockDb,
      config,
    });

    Deno.env.set("DENO_TEST", "1");

    await assertRejects(
      async () => await runner.execute(flow as IFlow, { userPrompt: "test request", traceId: "test-trace-budget" }),
      FlowExecutionError,
      "Retry budget exceeded",
    );

    assertEquals(mockAgentRunner.calls, ["flaky-agent", "flaky-agent"]);
    assertEquals(mockDb.queryCallCount, 2);
  } finally {
    if (previousTestMode === undefined) {
      Deno.env.delete("DENO_TEST");
    } else {
      Deno.env.set("DENO_TEST", previousTestMode);
    }
    await Deno.remove(tempDir, { recursive: true });
  }
});
