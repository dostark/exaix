/**
 * @module ParallelGroupMergeTest
 * @path tests/flows/parallel_group_merge_test.ts
 * @description Covers FlowRunner fan-in merge summaries for downstream step requests.
 * @architectural-layer Tests
 * @related-files [src/flows/flow_runner.ts]
 */

import { assertEquals, assertExists } from "@std/assert";
import { FlowInputSource, FlowOutputFormat } from "@exaix/core";
import {
  FlowRunner,
  type IAgentExecutor,
  type IFlowEventLogger,
  type IFlowStepRequest,
} from "../../src/flows/flow_runner.ts";
import type { IFlow, IFlowInput } from "@exaix/schemas/flow.ts";
import type { IAgentExecutionResult } from "../../src/services/agent/agent_runner.ts";
import {
  DEFAULT_FLOW_STEP_BACKOFF_MS,
  DEFAULT_FLOW_VERSION,
  FLOW_EVENT_PARALLEL_GROUP_MERGE_FAILED,
} from "@exaix/core";
import type { JSONValue } from "@exaix/core/types/json.ts";

class CapturingExecutor implements IAgentExecutor {
  readonly capturedRequests: Array<{ identityId: string; request: IFlowStepRequest }> = [];
  private readonly responses = new Map<string, string | Error>();

  constructor(responses: Record<string, string | Error>) {
    for (const [identityId, response] of Object.entries(responses)) {
      this.responses.set(identityId, response);
    }
  }

  async run(identityId: string, request: IFlowStepRequest): Promise<IAgentExecutionResult> {
    this.capturedRequests.push({ identityId, request });
    const response = this.responses.get(identityId);
    if (!response) {
      throw new Error(`No response configured for ${identityId}`);
    }
    if (response instanceof Error) {
      throw response;
    }
    return await Promise.resolve({ thought: `processed ${identityId}`, content: response, raw: response });
  }
}

class SilentLogger implements IFlowEventLogger {
  log(_event: string, _payload: Record<string, JSONValue | undefined>): void {}
}

class CapturingLogger implements IFlowEventLogger {
  readonly events: Array<{ event: string; payload: Record<string, JSONValue | undefined> }> = [];

  log(event: string, payload: Record<string, JSONValue | undefined>): void {
    this.events.push({ event, payload });
  }
}

Deno.test("[Step65.3] FlowRunner injects ordered parallelGroupResults into downstream requests", async () => {
  const executor = new CapturingExecutor({
    starter: "start",
    writerA: "alpha output",
    writerB: "beta output",
    merger: "merged",
  });
  const runner = new FlowRunner({ agentExecutor: executor, eventLogger: new SilentLogger() });

  const flow: IFlowInput = {
    id: "ordered-parallel-group-flow",
    name: "Ordered Parallel Group Flow",
    description: "Ensures ordered fan-in summaries are injected into the downstream request",
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
        id: "draft-a",
        name: "Draft A",
        identity: "writerA",
        dependsOn: ["start"],
        input: { source: FlowInputSource.STEP, stepId: "start", transform: "passthrough" },
        retry: { maxAttempts: 1, backoffMs: DEFAULT_FLOW_STEP_BACKOFF_MS },
        parallel: { group: "writers", order: ["draft-b", "draft-a"] },
      },
      {
        id: "draft-b",
        name: "Draft B",
        identity: "writerB",
        dependsOn: ["start"],
        input: { source: FlowInputSource.STEP, stepId: "start", transform: "passthrough" },
        retry: { maxAttempts: 1, backoffMs: DEFAULT_FLOW_STEP_BACKOFF_MS },
        parallel: { group: "writers", order: ["draft-b", "draft-a"] },
      },
      {
        id: "merge",
        name: "Merge",
        identity: "merger",
        dependsOn: ["draft-a", "draft-b"],
        input: { source: FlowInputSource.REQUEST, transform: "passthrough" },
        retry: { maxAttempts: 1, backoffMs: DEFAULT_FLOW_STEP_BACKOFF_MS },
        mergeFromGroups: ["writers"],
        mergeMode: "ordered",
      },
    ],
    output: { from: "merge", format: FlowOutputFormat.MARKDOWN },
    settings: { maxParallelism: 4, failFast: true },
  };

  const result = await runner.execute(flow as IFlow, { userPrompt: "fan-in request" });

  assertEquals(result.success, true);
  const mergeRequest = executor.capturedRequests.find((entry) => entry.identityId === "merger");
  assertExists(mergeRequest);
  assertExists(mergeRequest.request.parallelGroupResults);
  assertEquals(mergeRequest.request.parallelGroupResults.writers.groupId, "writers");
  assertEquals(
    mergeRequest.request.parallelGroupResults.writers.mergedOutput,
    "## Step 1\nbeta output\n\n## Step 2\nalpha output",
  );
  assertEquals(mergeRequest.request.parallelGroupResults.writers.memberCount, 2);
  assertEquals(mergeRequest.request.parallelGroupResults.writers.successCount, 2);
  assertEquals(Number.isNaN(Date.parse(mergeRequest.request.parallelGroupResults.writers.completedAt)), false);
});

Deno.test("[Step65.3] FlowRunner concat merge uses lexicographic fallback order", async () => {
  const executor = new CapturingExecutor({
    starter: "start",
    zebraAgent: "zebra output",
    alphaAgent: "alpha output",
    merger: "merged",
  });
  const runner = new FlowRunner({ agentExecutor: executor, eventLogger: new SilentLogger() });

  const flow: IFlowInput = {
    id: "concat-parallel-group-flow",
    name: "Concat Parallel Group Flow",
    description: "Uses lexicographic order when no explicit group order is set",
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
        id: "zeta",
        name: "Zeta",
        identity: "zebraAgent",
        dependsOn: ["start"],
        input: { source: FlowInputSource.STEP, stepId: "start", transform: "passthrough" },
        retry: { maxAttempts: 1, backoffMs: DEFAULT_FLOW_STEP_BACKOFF_MS },
        parallel: { group: "writers" },
      },
      {
        id: "alpha",
        name: "Alpha",
        identity: "alphaAgent",
        dependsOn: ["start"],
        input: { source: FlowInputSource.STEP, stepId: "start", transform: "passthrough" },
        retry: { maxAttempts: 1, backoffMs: DEFAULT_FLOW_STEP_BACKOFF_MS },
        parallel: { group: "writers" },
      },
      {
        id: "merge",
        name: "Merge",
        identity: "merger",
        dependsOn: ["zeta", "alpha"],
        input: { source: FlowInputSource.REQUEST, transform: "passthrough" },
        retry: { maxAttempts: 1, backoffMs: DEFAULT_FLOW_STEP_BACKOFF_MS },
        mergeFromGroups: ["writers"],
        mergeMode: "concat",
      },
    ],
    output: { from: "merge", format: FlowOutputFormat.MARKDOWN },
    settings: { maxParallelism: 4, failFast: true },
  };

  const result = await runner.execute(flow as IFlow, { userPrompt: "concat request" });

  assertEquals(result.success, true);
  const mergeRequest = executor.capturedRequests.find((entry) => entry.identityId === "merger");
  assertExists(mergeRequest);
  assertExists(mergeRequest.request.parallelGroupResults);
  assertEquals(mergeRequest.request.parallelGroupResults.writers.mergedOutput, "alpha output\n\nzebra output");
});

Deno.test("[Step65.3] FlowRunner manual merge leaves mergedOutput empty", async () => {
  const executor = new CapturingExecutor({
    starter: "start",
    writerA: "alpha output",
    writerB: "beta output",
    merger: "merged",
  });
  const runner = new FlowRunner({ agentExecutor: executor, eventLogger: new SilentLogger() });

  const flow: IFlowInput = {
    id: "manual-parallel-group-flow",
    name: "Manual Parallel Group Flow",
    description: "Manual fan-in should not auto-aggregate merged output",
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
        id: "draft-a",
        name: "Draft A",
        identity: "writerA",
        dependsOn: ["start"],
        input: { source: FlowInputSource.STEP, stepId: "start", transform: "passthrough" },
        retry: { maxAttempts: 1, backoffMs: DEFAULT_FLOW_STEP_BACKOFF_MS },
        parallel: { group: "writers" },
      },
      {
        id: "draft-b",
        name: "Draft B",
        identity: "writerB",
        dependsOn: ["start"],
        input: { source: FlowInputSource.STEP, stepId: "start", transform: "passthrough" },
        retry: { maxAttempts: 1, backoffMs: DEFAULT_FLOW_STEP_BACKOFF_MS },
        parallel: { group: "writers" },
      },
      {
        id: "merge",
        name: "Merge",
        identity: "merger",
        dependsOn: ["draft-a", "draft-b"],
        input: { source: FlowInputSource.REQUEST, transform: "passthrough" },
        retry: { maxAttempts: 1, backoffMs: DEFAULT_FLOW_STEP_BACKOFF_MS },
        mergeFromGroups: ["writers"],
        mergeMode: "manual",
      },
    ],
    output: { from: "merge", format: FlowOutputFormat.MARKDOWN },
    settings: { maxParallelism: 4, failFast: true },
  };

  const result = await runner.execute(flow as IFlow, { userPrompt: "manual request" });

  assertEquals(result.success, true);
  const mergeRequest = executor.capturedRequests.find((entry) => entry.identityId === "merger");
  assertExists(mergeRequest);
  assertExists(mergeRequest.request.parallelGroupResults);
  assertEquals(mergeRequest.request.parallelGroupResults.writers.mergedOutput, "");
  assertEquals(mergeRequest.request.parallelGroupResults.writers.memberCount, 2);
  assertEquals(mergeRequest.request.parallelGroupResults.writers.successCount, 2);
});

Deno.test("[Step65.3] FlowRunner journals merge failures for automatic fan-in modes", async () => {
  const executor = new CapturingExecutor({
    starter: "start",
    writerA: "alpha output",
    writerB: new Error("writer failed"),
    merger: "merged",
  });
  const logger = new CapturingLogger();
  const runner = new FlowRunner({ agentExecutor: executor, eventLogger: logger });

  const flow: IFlowInput = {
    id: "merge-failure-parallel-group-flow",
    name: "Merge Failure Parallel Group Flow",
    description: "Automatic fan-in should journal failures when a group member has no successful output",
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
        id: "draft-a",
        name: "Draft A",
        identity: "writerA",
        dependsOn: ["start"],
        input: { source: FlowInputSource.STEP, stepId: "start", transform: "passthrough" },
        retry: { maxAttempts: 1, backoffMs: DEFAULT_FLOW_STEP_BACKOFF_MS },
        parallel: { group: "writers" },
      },
      {
        id: "draft-b",
        name: "Draft B",
        identity: "writerB",
        dependsOn: ["start"],
        input: { source: FlowInputSource.STEP, stepId: "start", transform: "passthrough" },
        retry: { maxAttempts: 1, backoffMs: DEFAULT_FLOW_STEP_BACKOFF_MS },
        parallel: { group: "writers" },
      },
      {
        id: "merge",
        name: "Merge",
        identity: "merger",
        dependsOn: ["draft-a", "draft-b"],
        input: { source: FlowInputSource.REQUEST, transform: "passthrough" },
        retry: { maxAttempts: 1, backoffMs: DEFAULT_FLOW_STEP_BACKOFF_MS },
        mergeFromGroups: ["writers"],
        mergeMode: "all",
      },
    ],
    output: { from: "merge", format: FlowOutputFormat.MARKDOWN },
    settings: { maxParallelism: 4, failFast: false },
  };

  const result = await runner.execute(flow as IFlow, { userPrompt: "merge failure request" });

  assertEquals(result.success, false);
  assertEquals(
    result.stepResults.get("merge")?.error?.includes("Parallel group 'writers' cannot be merged"),
    true,
  );
  const mergeFailureEvent = logger.events.find(
    (entry) => entry.event === FLOW_EVENT_PARALLEL_GROUP_MERGE_FAILED,
  );
  assertExists(mergeFailureEvent);
  assertEquals(mergeFailureEvent.payload.groupId, "writers");
  assertEquals(mergeFailureEvent.payload.mergeMode, "all");
  assertEquals(mergeFailureEvent.payload.stepId, "merge");
  assertEquals(typeof mergeFailureEvent.payload.error, "string");
  assertEquals(
    String(mergeFailureEvent.payload.error).includes("Parallel group 'writers' cannot be merged"),
    true,
  );
});
