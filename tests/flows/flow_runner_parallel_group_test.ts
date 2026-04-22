/**
 * @module FlowRunnerParallelGroupTest
 * @path tests/flows/flow_runner_parallel_group_test.ts
 * @description Verifies wave-local parallel group execution and lifecycle events in FlowRunner.
 * @architectural-layer Tests
 * @related-files [src/flows/flow_runner.ts]
 */

import { assertEquals, assertExists } from "@std/assert";
import { FlowInputSource, FlowOutputFormat } from "../../src/shared/enums.ts";
import { FlowRunner, type IAgentExecutor, type IFlowStepRequest } from "../../src/flows/flow_runner.ts";
import type { IFlow, IFlowInput } from "@exaix/schemas/flow.ts";
import type { IAgentExecutionResult } from "../../src/services/agent/agent_runner.ts";
import {
  DEFAULT_FLOW_STEP_BACKOFF_MS,
  DEFAULT_FLOW_VERSION,
  FLOW_EVENT_PARALLEL_GROUP_COMPLETED,
  FLOW_EVENT_PARALLEL_GROUP_STARTED,
} from "../../src/shared/constants.ts";
import { RecordingFlowLogger } from "../helpers/flow_namespace_test_helper.ts";

interface IStartWaiter {
  ids: string[];
  resolve: () => void;
}

function createDeferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}

class ControlledParallelExecutor implements IAgentExecutor {
  readonly calls: string[] = [];
  private readonly started = new Set<string>();
  private readonly startWaiters: IStartWaiter[] = [];
  private readonly gates = new Map<string, { promise: Promise<void>; resolve: () => void }>();

  constructor(blockedIdentityIds: string[]) {
    for (const identityId of blockedIdentityIds) {
      this.gates.set(identityId, createDeferred());
    }
  }

  async run(identityId: string, _request: IFlowStepRequest): Promise<IAgentExecutionResult> {
    this.calls.push(identityId);
    this.started.add(identityId);
    this.resolveSatisfiedWaiters();

    const gate = this.gates.get(identityId);
    if (gate) {
      await gate.promise;
    }

    return {
      thought: `processed ${identityId}`,
      content: `${identityId} result`,
      raw: `${identityId} raw`,
    };
  }

  async waitForStarts(identityIds: string[]): Promise<void> {
    if (identityIds.every((identityId) => this.started.has(identityId))) {
      return;
    }

    await new Promise<void>((resolve) => {
      this.startWaiters.push({ ids: [...identityIds], resolve });
    });
  }

  release(identityId: string): void {
    this.gates.get(identityId)?.resolve();
  }

  private resolveSatisfiedWaiters(): void {
    for (let index = this.startWaiters.length - 1; index >= 0; index--) {
      const waiter = this.startWaiters[index];
      if (!waiter.ids.every((identityId) => this.started.has(identityId))) {
        continue;
      }

      this.startWaiters.splice(index, 1);
      waiter.resolve();
    }
  }
}

Deno.test("FlowRunner: emits parallel group lifecycle events for same-wave grouped steps", async () => {
  const executor = new ControlledParallelExecutor(["reviewer-a", "reviewer-b"]);
  const logger = new RecordingFlowLogger();
  const runner = new FlowRunner({ agentExecutor: executor, eventLogger: logger });

  const flow: IFlowInput = {
    id: "parallel-group-wave-flow",
    name: "Parallel Group Wave Flow",
    description: "Grouped steps in the same wave should emit explicit lifecycle events",
    version: DEFAULT_FLOW_VERSION,
    steps: [
      {
        id: "start",
        name: "Start",
        identity: "starter",
        dependsOn: [],
        input: { source: FlowInputSource.REQUEST, transform: "passthrough" },
        retry: { maxAttempts: 1, backoffMs: DEFAULT_FLOW_STEP_BACKOFF_MS },
      },
      {
        id: "review-a",
        name: "Review A",
        identity: "reviewer-a",
        dependsOn: ["start"],
        input: { source: FlowInputSource.STEP, stepId: "start", transform: "passthrough" },
        retry: { maxAttempts: 1, backoffMs: DEFAULT_FLOW_STEP_BACKOFF_MS },
        parallel: { group: "reviewers" },
      },
      {
        id: "review-b",
        name: "Review B",
        identity: "reviewer-b",
        dependsOn: ["start"],
        input: { source: FlowInputSource.STEP, stepId: "start", transform: "passthrough" },
        retry: { maxAttempts: 1, backoffMs: DEFAULT_FLOW_STEP_BACKOFF_MS },
        parallel: { group: "reviewers" },
      },
      {
        id: "audit",
        name: "Audit",
        identity: "auditor",
        dependsOn: ["start"],
        input: { source: FlowInputSource.STEP, stepId: "start", transform: "passthrough" },
        retry: { maxAttempts: 1, backoffMs: DEFAULT_FLOW_STEP_BACKOFF_MS },
      },
    ],
    output: { from: ["review-a", "review-b", "audit"], format: FlowOutputFormat.CONCAT },
    settings: { maxParallelism: 4, failFast: true },
  };

  const execution = runner.execute(flow as IFlow, {
    userPrompt: "run grouped wave",
    traceId: "trace-65-2-unit",
    requestId: "req-65-2-unit",
  });

  await executor.waitForStarts(["reviewer-a", "reviewer-b"]);

  const startedEvent = logger.events.find((entry) => entry.event === FLOW_EVENT_PARALLEL_GROUP_STARTED);
  assertExists(startedEvent);
  assertEquals(startedEvent.payload.groupId, "reviewers");
  assertEquals(startedEvent.payload.stepIds, ["review-a", "review-b"]);
  assertEquals(startedEvent.payload.waveNumber, 2);

  executor.release("reviewer-a");
  executor.release("reviewer-b");

  const result = await execution;

  const completedEvent = logger.events.find((entry) => entry.event === FLOW_EVENT_PARALLEL_GROUP_COMPLETED);
  assertExists(completedEvent);
  assertEquals(completedEvent.payload.groupId, "reviewers");
  assertEquals(completedEvent.payload.stepIds, ["review-a", "review-b"]);
  assertEquals(completedEvent.payload.successCount, 2);
  assertEquals(completedEvent.payload.failureCount, 0);
  assertEquals(completedEvent.payload.failed, false);
  assertEquals(result.stepResults.get("audit")?.success, true);
});
