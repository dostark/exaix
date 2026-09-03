/**
 * @module ParallelFanInMergeIntegrationTest
 * @path tests/integration/flow_parallel_fanin_merge_test.ts
 * @description Verifies downstream fan-in steps receive JSON-safe parallelGroupResults.
 * @architectural-layer Tests
 * @related-files [packages/flow/src/flow_runner.ts]
 */

import { assertEquals, assertExists } from "@std/assert";
import { FlowInputSource, FlowOutputFormat } from "@exaix/core";
import { FlowRunner } from "@exaix/flow";
import type { IFlow, IFlowInput } from "@exaix/schemas/flow.ts";
import { DEFAULT_FLOW_STEP_BACKOFF_MS, DEFAULT_FLOW_VERSION } from "@exaix/core";
import { initTestDbService } from "@exaix/testing";
import {
  makeStartAndWritersSteps,
  RecordingFlowLogger,
  ScriptedAgentExecutor,
} from "../helpers/flow_namespace_test_helper.ts";

Deno.test("[Step65.3] FlowRunner passes JSON-safe parallelGroupResults to downstream fan-in steps", async () => {
  const { config, cleanup } = await initTestDbService();

  try {
    const executor = new ScriptedAgentExecutor({
      starter: ["start result"],
      writerA: ["alpha output"],
      writerB: ["beta output"],
      merger: [(request) => JSON.stringify(request.parallelGroupResults)],
    });
    const runner = new FlowRunner({
      agentExecutor: executor,
      eventLogger: new RecordingFlowLogger(),
      config,
    });

    const flow: IFlowInput = {
      id: "parallel-fanin-merge-flow",
      name: "Parallel Fan-In Merge Flow",
      description: "Downstream fan-in requests should receive JSON-safe group summaries",
      version: DEFAULT_FLOW_VERSION,
      steps: [
        ...makeStartAndWritersSteps(),
        {
          id: "merge",
          name: "Merge",
          agent_role: "merger",
          dependsOn: ["draft-a", "draft-b"],
          input: { source: FlowInputSource.REQUEST, transform: "passthrough" },
          retry: { maxAttempts: 1, backoffMs: DEFAULT_FLOW_STEP_BACKOFF_MS },
          mergeFromGroups: ["writers"],
        },
      ],
      output: { from: "merge", format: FlowOutputFormat.MARKDOWN },
      settings: { maxParallelism: 4, failFast: true },
    };

    const result = await runner.execute(flow as IFlow, {
      userPrompt: "run fan-in merge",
      traceId: "trace-65-3-integration",
      requestId: "req-65-3-integration",
    });

    assertEquals(result.success, true);
    const mergeRequest = executor.capturedRequests.find((entry) => entry.agentRole === "merger");
    assertExists(mergeRequest);
    assertExists(mergeRequest.request.parallelGroupResults);
    assertEquals(typeof mergeRequest.request.parallelGroupResults.writers.completedAt, "string");

    const parsed = JSON.parse(result.output) as {
      writers: {
        groupId: string;
        mergedOutput: string;
        memberCount: number;
        successCount: number;
        completedAt: string;
      };
    };

    assertEquals(parsed.writers.groupId, "writers");
    assertEquals(parsed.writers.memberCount, 2);
    assertEquals(parsed.writers.successCount, 2);
    assertEquals(Number.isNaN(Date.parse(parsed.writers.completedAt)), false);
    assertEquals(
      parsed.writers.mergedOutput,
      "## Step 1\nalpha output\n\n## Step 2\nbeta output",
    );
  } finally {
    await cleanup();
  }
});
