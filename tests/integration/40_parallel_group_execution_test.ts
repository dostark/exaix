/**
 * @module ParallelGroupExecutionIntegrationTest
 * @path tests/integration/40_parallel_group_execution_test.ts
 * @description Verifies grouped wave execution completes before downstream fan-in steps run.
 * @architectural-layer Tests
 * @related-files [src/flows/flow_runner.ts]
 */

import { assertEquals, assertExists } from "@std/assert";
import { FlowInputSource, FlowOutputFormat } from "../../src/shared/enums.ts";
import { FlowRunner } from "../../src/flows/flow_runner.ts";
import type { IFlow, IFlowInput } from "../../src/shared/schemas/flow.ts";
import {
  DEFAULT_FLOW_STEP_BACKOFF_MS,
  DEFAULT_FLOW_VERSION,
  FLOW_EVENT_PARALLEL_GROUP_COMPLETED,
  FLOW_EVENT_PARALLEL_GROUP_STARTED,
} from "../../src/shared/constants.ts";
import { initTestDbService } from "../helpers/db.ts";
import { RecordingFlowLogger, ScriptedAgentExecutor } from "../helpers/flow_namespace_test_helper.ts";

Deno.test("[Step65.2] FlowRunner logs grouped wave lifecycle before downstream join execution", async () => {
  const { config, cleanup } = await initTestDbService();

  try {
    const logger = new RecordingFlowLogger();
    const executor = new ScriptedAgentExecutor({
      starter: ["start result"],
      writerA: ["draft-a"],
      writerB: ["draft-b"],
      merger: [(request) => JSON.stringify({ context: request.context })],
    });
    const runner = new FlowRunner({ agentExecutor: executor, eventLogger: logger, config });

    const flow: IFlowInput = {
      id: "parallel-group-join-flow",
      name: "Parallel Group Join Flow",
      description: "Downstream join step should run after grouped wave completion",
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
          input: { source: FlowInputSource.AGGREGATE, from: ["draft-a", "draft-b"], transform: "passthrough" },
          retry: { maxAttempts: 1, backoffMs: DEFAULT_FLOW_STEP_BACKOFF_MS },
        },
      ],
      output: { from: "merge", format: FlowOutputFormat.MARKDOWN },
      settings: { maxParallelism: 4, failFast: true },
    };

    const result = await runner.execute(flow as IFlow, {
      userPrompt: "run grouped integration wave",
      traceId: "trace-65-2-integration",
      requestId: "req-65-2-integration",
    });

    const startedEventIndex = logger.events.findIndex(
      (entry) => entry.event === FLOW_EVENT_PARALLEL_GROUP_STARTED,
    );
    const completedEventIndex = logger.events.findIndex(
      (entry) => entry.event === FLOW_EVENT_PARALLEL_GROUP_COMPLETED,
    );
    const mergeStartedIndex = logger.events.findIndex((entry) => {
      return entry.event === "flow.step.started" && entry.payload.stepId === "merge";
    });
    const completedEvent = logger.events[completedEventIndex];

    assertEquals(result.success, true);
    assertExists(result.stepResults.get("merge"));
    assertEquals(startedEventIndex >= 0, true);
    assertEquals(completedEventIndex > startedEventIndex, true);
    assertEquals(mergeStartedIndex > completedEventIndex, true);
    assertExists(completedEvent);
    assertEquals(completedEvent.payload.groupId, "writers");
    assertEquals(completedEvent.payload.stepIds, ["draft-a", "draft-b"]);
    assertEquals(completedEvent.payload.successCount, 2);
    assertEquals(completedEvent.payload.failureCount, 0);
  } finally {
    await cleanup();
  }
});
