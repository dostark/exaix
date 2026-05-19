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
import type { JSONValue } from "@exaix/core/types";

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

type MergeMode = "ordered" | "concat" | "manual" | "all";

interface IParallelStepDefinition {
  id: string;
  name: string;
  identity: string;
}

interface IParallelFlowDefinition {
  flowId: string;
  flowName: string;
  description: string;
  responses: Record<string, string | Error>;
  parallelSteps: IParallelStepDefinition[];
  mergeMode: MergeMode;
  mergeDependsOn?: string[];
  parallelOrder?: string[];
  failFast?: boolean;
  eventLogger?: IFlowEventLogger;
}

function createParallelStep(step: IParallelStepDefinition, parallelOrder?: string[]) {
  return {
    id: step.id,
    name: step.name,
    identity: step.identity,
    dependsOn: ["start"],
    input: { source: FlowInputSource.STEP, stepId: "start", transform: "passthrough" },
    retry: { maxAttempts: 1, backoffMs: DEFAULT_FLOW_STEP_BACKOFF_MS },
    parallel: parallelOrder ? { group: "writers", order: parallelOrder } : { group: "writers" },
  };
}

function createParallelFlowHarness(definition: IParallelFlowDefinition) {
  const executor = new CapturingExecutor(definition.responses);
  const runner = new FlowRunner({
    agentExecutor: executor,
    eventLogger: definition.eventLogger ?? new SilentLogger(),
  });
  const flow: IFlowInput = {
    id: definition.flowId,
    name: definition.flowName,
    description: definition.description,
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
      ...definition.parallelSteps.map((step) => createParallelStep(step, definition.parallelOrder)),
      {
        id: "merge",
        name: "Merge",
        identity: "merger",
        dependsOn: definition.mergeDependsOn ?? definition.parallelSteps.map((step) => step.id),
        input: { source: FlowInputSource.REQUEST, transform: "passthrough" },
        retry: { maxAttempts: 1, backoffMs: DEFAULT_FLOW_STEP_BACKOFF_MS },
        mergeFromGroups: ["writers"],
        mergeMode: definition.mergeMode,
      },
    ],
    output: { from: "merge", format: FlowOutputFormat.MARKDOWN },
    settings: { maxParallelism: 4, failFast: definition.failFast ?? true },
  };

  return { executor, runner, flow };
}

function getWritersGroupResult(executor: CapturingExecutor) {
  const mergeRequest = executor.capturedRequests.find((entry) => entry.identityId === "merger");
  assertExists(mergeRequest);
  assertExists(mergeRequest.request.parallelGroupResults);
  return mergeRequest.request.parallelGroupResults.writers;
}

Deno.test("[Step65.3] FlowRunner injects ordered parallelGroupResults into downstream requests", async () => {
  const { executor, runner, flow } = createParallelFlowHarness({
    flowId: "ordered-parallel-group-flow",
    flowName: "Ordered Parallel Group Flow",
    description: "Ensures ordered fan-in summaries are injected into the downstream request",
    responses: {
      starter: "start",
      writerA: "alpha output",
      writerB: "beta output",
      merger: "merged",
    },
    parallelSteps: [
      { id: "draft-a", name: "Draft A", identity: "writerA" },
      { id: "draft-b", name: "Draft B", identity: "writerB" },
    ],
    mergeMode: "ordered",
    parallelOrder: ["draft-b", "draft-a"],
  });

  const result = await runner.execute(flow as IFlow, { userPrompt: "fan-in request" });

  assertEquals(result.success, true);
  const writersResult = getWritersGroupResult(executor);
  assertEquals(writersResult.groupId, "writers");
  assertEquals(
    writersResult.mergedOutput,
    "## Step 1\nbeta output\n\n## Step 2\nalpha output",
  );
  assertEquals(writersResult.memberCount, 2);
  assertEquals(writersResult.successCount, 2);
  assertEquals(Number.isNaN(Date.parse(writersResult.completedAt)), false);
});

Deno.test("[Step65.3] FlowRunner concat merge uses lexicographic fallback order", async () => {
  const { executor, runner, flow } = createParallelFlowHarness({
    flowId: "concat-parallel-group-flow",
    flowName: "Concat Parallel Group Flow",
    description: "Uses lexicographic order when no explicit group order is set",
    responses: {
      starter: "start",
      zebraAgent: "zebra output",
      alphaAgent: "alpha output",
      merger: "merged",
    },
    parallelSteps: [
      { id: "zeta", name: "Zeta", identity: "zebraAgent" },
      { id: "alpha", name: "Alpha", identity: "alphaAgent" },
    ],
    mergeMode: "concat",
  });

  const result = await runner.execute(flow as IFlow, { userPrompt: "concat request" });

  assertEquals(result.success, true);
  assertEquals(getWritersGroupResult(executor).mergedOutput, "alpha output\n\nzebra output");
});

Deno.test("[Step65.3] FlowRunner manual merge leaves mergedOutput empty", async () => {
  const { executor, runner, flow } = createParallelFlowHarness({
    flowId: "manual-parallel-group-flow",
    flowName: "Manual Parallel Group Flow",
    description: "Manual fan-in should not auto-aggregate merged output",
    responses: {
      starter: "start",
      writerA: "alpha output",
      writerB: "beta output",
      merger: "merged",
    },
    parallelSteps: [
      { id: "draft-a", name: "Draft A", identity: "writerA" },
      { id: "draft-b", name: "Draft B", identity: "writerB" },
    ],
    mergeMode: "manual",
  });

  const result = await runner.execute(flow as IFlow, { userPrompt: "manual request" });

  assertEquals(result.success, true);
  const writersResult = getWritersGroupResult(executor);
  assertEquals(writersResult.mergedOutput, "");
  assertEquals(writersResult.memberCount, 2);
  assertEquals(writersResult.successCount, 2);
});

Deno.test("[Step65.3] FlowRunner journals merge failures for automatic fan-in modes", async () => {
  const logger = new CapturingLogger();
  const { runner, flow } = createParallelFlowHarness({
    flowId: "merge-failure-parallel-group-flow",
    flowName: "Merge Failure Parallel Group Flow",
    description: "Automatic fan-in should journal failures when a group member has no successful output",
    responses: {
      starter: "start",
      writerA: "alpha output",
      writerB: new Error("writer failed"),
      merger: "merged",
    },
    parallelSteps: [
      { id: "draft-a", name: "Draft A", identity: "writerA" },
      { id: "draft-b", name: "Draft B", identity: "writerB" },
    ],
    mergeMode: "all",
    failFast: false,
    eventLogger: logger,
  });

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
