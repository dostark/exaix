/**
 * @module FlowRunnerParallelGroupTest
 * @path tests/flows/flow_runner_parallel_group_test.ts
 * @description Verifies wave-local parallel group execution and lifecycle events in FlowRunner.
 * @architectural-layer Tests
 * @related-files [packages/flow/src/flow_runner.ts]
 */

import { assertEquals, assertExists } from "@std/assert";
import type { JSONObject } from "@exaix/core/types";
import { FlowInputSource, FlowOutputFormat } from "@exaix/core";
import { FlowRunner, type IAgentExecutor, type IFlowStepRequest } from "@exaix/flow";
import type { IFlow, IFlowInput } from "@exaix/schemas/flow.ts";
import type { IAgentExecutionResult } from "@exaix/execution";
import {
  DEFAULT_FLOW_STEP_BACKOFF_MS,
  DEFAULT_FLOW_VERSION,
  FLOW_EVENT_PARALLEL_GROUP_COMPLETED,
  FLOW_EVENT_PARALLEL_GROUP_STARTED,
} from "@exaix/core";
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

  constructor(blockedAgentRoleIds: string[]) {
    for (const agentRole of blockedAgentRoleIds) {
      this.gates.set(agentRole, createDeferred());
    }
  }

  async run(agentRole: string, _request: IFlowStepRequest): Promise<IAgentExecutionResult> {
    this.calls.push(agentRole);
    this.started.add(agentRole);
    this.resolveSatisfiedWaiters();

    const gate = this.gates.get(agentRole);
    if (gate) {
      await gate.promise;
    }

    return {
      thought: `processed ${agentRole}`,
      content: `${agentRole} result`,
      raw: `${agentRole} raw`,
    };
  }

  async waitForStarts(agentRoles: string[]): Promise<void> {
    if (agentRoles.every((agentRole) => this.started.has(agentRole))) {
      return;
    }

    await new Promise<void>((resolve) => {
      this.startWaiters.push({ ids: [...agentRoles], resolve });
    });
  }

  release(agentRole: string): void {
    this.gates.get(agentRole)?.resolve();
  }

  private resolveSatisfiedWaiters(): void {
    for (let index = this.startWaiters.length - 1; index >= 0; index--) {
      const waiter = this.startWaiters[index];
      if (!waiter.ids.every((agentRole) => this.started.has(agentRole))) {
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
        agent_role: "starter",
        dependsOn: [],
        input: { source: FlowInputSource.REQUEST, transform: "passthrough" },
        retry: { maxAttempts: 1, backoffMs: DEFAULT_FLOW_STEP_BACKOFF_MS },
      },
      {
        id: "review-a",
        name: "Review A",
        agent_role: "reviewer-a",
        dependsOn: ["start"],
        input: { source: FlowInputSource.STEP, stepId: "start", transform: "passthrough" },
        retry: { maxAttempts: 1, backoffMs: DEFAULT_FLOW_STEP_BACKOFF_MS },
        parallel: { group: "reviewers" },
      },
      {
        id: "review-b",
        name: "Review B",
        agent_role: "reviewer-b",
        dependsOn: ["start"],
        input: { source: FlowInputSource.STEP, stepId: "start", transform: "passthrough" },
        retry: { maxAttempts: 1, backoffMs: DEFAULT_FLOW_STEP_BACKOFF_MS },
        parallel: { group: "reviewers" },
      },
      {
        id: "audit",
        name: "Audit",
        agent_role: "auditor",
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
  const startedPayload = startedEvent.payload as JSONObject;
  assertEquals(typeof startedPayload.isoStartedAt, "string");
  assertEquals((startedPayload.isoStartedAt as string).includes("T"), true);

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
