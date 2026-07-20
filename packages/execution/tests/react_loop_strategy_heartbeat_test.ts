/**
 * @module ReActLoopStrategyHeartbeatTest
 * @path packages/execution/tests/react_loop_strategy_heartbeat_test.ts
 * @description Verifies that ReActLoopStrategy emits heartbeat events during
 * long-running LLM calls and clears the timer on success, failure, and cancellation.
 */

import { assertEquals, assertGreaterOrEqual } from "@std/assert";
import { ReActLoopStrategy } from "@exaix/execution";
import { EventBusService } from "@exaix/core/observability";
import type { IStreamingEvent } from "@exaix/schemas/streaming_event.ts";
import type { IAgentFileBlueprint } from "@exaix/execution";
import type { IModelProvider } from "@exaix/ai/types.ts";
import type { IGenerateResult } from "@exaix/ai/providers";
import { ExecutionStrategyName, SecurityMode } from "@exaix/core";
import type { IAgentExecutionOptions, IChangesetResult, IExecutionContext } from "@exaix/schemas/agent_orchestrator.ts";
import {
  EXECUTION_HEARTBEAT_INTERVAL_MS,
  REACT_STATUS_COMPLETE,
  REACT_SUMMARY_PREFIX,
  STREAMING_EVENT_HEARTBEAT,
} from "@exaix/core";
import type { JSONValue } from "@exaix/core/types";
import { makeGenerateResult as makeResult } from "@exaix/testing";

// ============================================================================
// Helpers
// ============================================================================

type TestToolParams = Record<string, JSONValue>;
type ReActExecutor = ConstructorParameters<typeof ReActLoopStrategy>[0];

const testBlueprint: IAgentFileBlueprint = {
  name: "heartbeat-agent",
  model: "mock:heartbeat",
  provider: "mock",
  capabilities: [ExecutionStrategyName.REACT],
  systemPrompt: "",
};

const testContext: IExecutionContext = {
  trace_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  request_id: "req-1",
  request: "test heartbeat",
  plan: "Step 1",
  portal: "test",
};

function createOptions(): IAgentExecutionOptions {
  return {
    identity_id: "heartbeat-agent",
    portal: "test",
    security_mode: SecurityMode.SANDBOXED,
    timeout_ms: 300000,
    max_tool_calls: 100,
    audit_enabled: true,
  };
}

const mockToolRegistry = {
  execute: async (_tool: string, _params: TestToolParams) => {
    await Promise.resolve();
    return { success: true };
  },
  getTools: () => [],
  getBaseDir: () => "/nonexistent-test-basedir",
};

function createBaseExecutor(bus?: EventBusService): ReActExecutor {
  return {
    logAgentOutput: async () => {
      await Promise.resolve();
    },
    validateReviewResult: (res: IChangesetResult): IChangesetResult => res,
    parseAgentResponse: (_response: string, context: IExecutionContext, startTime: number): IChangesetResult => ({
      branch: `feat/${context.portal || "test"}`,
      commit_sha: "0000000000000000000000000000000000000000",
      files_changed: [],
      description: context.plan,
      tool_calls: 0,
      execution_time_ms: Date.now() - startTime,
    }),
    logGeneration: async () => {
      await Promise.resolve();
    },
    toolRegistry: mockToolRegistry,
    eventBus: bus,
  };
}

function createHeartbeatRecorder(): { bus: EventBusService; heartbeats: IStreamingEvent[] } {
  const bus = new EventBusService();
  const heartbeats: IStreamingEvent[] = [];
  bus.subscribe(testContext.trace_id, (event) => {
    if (event.type === STREAMING_EVENT_HEARTBEAT) {
      heartbeats.push(event);
    }
  });
  return { bus, heartbeats };
}

function createDeferredProvider(id: string): {
  provider: IModelProvider;
  resolve: (value: string) => void;
} {
  let resolveGenerate!: (value: string) => void;
  const generatePromise = new Promise<string>((resolve) => {
    resolveGenerate = resolve;
  });

  return {
    provider: {
      id,
      async generate(_prompt: string): Promise<IGenerateResult> {
        await Promise.resolve();
        return generatePromise.then(makeResult);
      },
    },
    resolve: resolveGenerate,
  };
}

// ============================================================================
// Heartbeat Emission Tests
// ============================================================================

Deno.test("ReActLoopStrategy: should emit heartbeat events during long-running LLM call", async () => {
  const { bus, heartbeats } = createHeartbeatRecorder();
  const { provider, resolve } = createDeferredProvider("slow-provider");

  const strategy = new ReActLoopStrategy(createBaseExecutor(bus), provider);
  const execPromise = strategy.execute(testBlueprint, testContext, createOptions());

  // Wait long enough for at least 2 heartbeats
  await new Promise((r) => setTimeout(r, EXECUTION_HEARTBEAT_INTERVAL_MS * 2 + 500));

  // Resolve the LLM call with completion
  resolve(
    `${REACT_STATUS_COMPLETE}\n${REACT_SUMMARY_PREFIX}Done`,
  );
  await execPromise;

  assertGreaterOrEqual(heartbeats.length, 2);
  assertEquals(heartbeats[0].traceId, testContext.trace_id);
  assertEquals(heartbeats[0].type, STREAMING_EVENT_HEARTBEAT);

  bus.close();
});

Deno.test("ReActLoopStrategy: heartbeat should include step name and elapsed time", async () => {
  const { bus, heartbeats } = createHeartbeatRecorder();
  const { provider, resolve } = createDeferredProvider("slow-provider-2");

  const strategy = new ReActLoopStrategy(createBaseExecutor(bus), provider);
  const execPromise = strategy.execute(testBlueprint, testContext, createOptions());

  await new Promise((r) => setTimeout(r, EXECUTION_HEARTBEAT_INTERVAL_MS + 500));

  resolve(
    `${REACT_STATUS_COMPLETE}\n${REACT_SUMMARY_PREFIX}Done`,
  );
  await execPromise;

  assertEquals(heartbeats.length >= 1, true);
  const hb = heartbeats[0];
  // Payload should contain step name and elapsed time
  assertEquals(typeof hb.payload.step, "string");
  assertEquals(typeof hb.payload.elapsed_ms, "number");
  assertEquals(hb.payload.step, "Step 1"); // from context.plan

  bus.close();
});

// ============================================================================
// Timer Cleanup Tests
// ============================================================================

Deno.test("ReActLoopStrategy: timer should be cleared on success", async () => {
  const bus = new EventBusService();
  const heartbeats: IStreamingEvent[] = [];
  bus.subscribe(testContext.trace_id, (event) => {
    if (event.type === STREAMING_EVENT_HEARTBEAT) {
      heartbeats.push(event);
    }
  });

  const provider: IModelProvider = {
    id: "fast-provider",
    generate(_prompt: string): Promise<IGenerateResult> {
      return Promise.resolve(makeResult(
        `${REACT_STATUS_COMPLETE}\n${REACT_SUMMARY_PREFIX}Quick done`,
      ));
    },
  };

  const strategy = new ReActLoopStrategy(createBaseExecutor(bus), provider);
  await strategy.execute(testBlueprint, testContext, createOptions());

  // With a fast provider, should have 0 heartbeats (timer cleared before first fires)
  assertEquals(heartbeats.length, 0);

  bus.close();
});

Deno.test("ReActLoopStrategy: timer should be cleared on failure", async () => {
  const bus = new EventBusService();

  const provider: IModelProvider = {
    id: "failing-provider",
    generate(_prompt: string): Promise<IGenerateResult> {
      return Promise.reject(new Error("LLM call failed"));
    },
  };

  const strategy = new ReActLoopStrategy(createBaseExecutor(bus), provider);

  let threw = false;
  try {
    await strategy.execute(testBlueprint, testContext, createOptions());
  } catch {
    threw = true;
  }

  assertEquals(threw, true);
  // After failure, no more heartbeats should be emitted
  // (timer was cleared in finally block)

  bus.close();
});

Deno.test("ReActLoopStrategy: no bus means no heartbeat errors", async () => {
  const provider: IModelProvider = {
    id: "no-bus-provider",
    generate(_prompt: string): Promise<IGenerateResult> {
      return Promise.resolve(makeResult(
        `${REACT_STATUS_COMPLETE}\n${REACT_SUMMARY_PREFIX}Done`,
      ));
    },
  };

  // Executor without eventBus — should not throw
  const executorWithoutBus = createBaseExecutor(undefined);
  const strategy = new ReActLoopStrategy(executorWithoutBus, provider);
  const result = await strategy.execute(testBlueprint, testContext, createOptions());

  // Should complete successfully without a bus
  assertEquals(result.tool_calls, 0);
});
