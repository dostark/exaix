/**
 * @module ParallelGroupCheckpointTest
 * @path tests/integration/42_parallel_group_checkpoint_test.ts
 * @description Verifies checkpoint persistence and resume behavior for parallel group members.
 * @architectural-layer Tests
 * @related-files [src/flows/flow_runner.ts, src/services/flow/flow_checkpoint_service.ts]
 */

import { assertEquals, assertExists } from "@std/assert";
import { exists } from "@std/fs";
import { join } from "@std/path";
import { FlowInputSource, FlowOutputFormat } from "@exaix/core";
import { FlowRunner } from "../../src/flows/flow_runner.ts";
import type { IFlow, IFlowInput } from "@exaix/schemas/flow.ts";
import { DEFAULT_FLOW_STEP_BACKOFF_MS, DEFAULT_FLOW_VERSION, FLOW_EVENT_CHECKPOINT_LOADED } from "@exaix/core";
import { initTestDbService } from "../helpers/db.ts";
import { RecordingFlowLogger, ScriptedAgentExecutor } from "../helpers/flow_namespace_test_helper.ts";

Deno.test("[Step65.4] FlowRunner checkpoint captures individual parallel group members and resumes without re-running", async () => {
  const { config, tempDir, cleanup } = await initTestDbService();

  try {
    const traceId = "trace-parallel-group-checkpoint";
    const requestId = "req-parallel-group-checkpoint";
    const checkpointPath = join(tempDir, "Memory", "Execution", traceId, "checkpoint.json");

    const flow: IFlowInput = {
      id: "parallel-group-checkpoint-flow",
      name: "Parallel Group Checkpoint Flow",
      description: "Verify checkpoint captures individual group members and resume skips completed",
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
          identity: "reviewerA",
          dependsOn: ["start"],
          input: { source: FlowInputSource.STEP, stepId: "start", transform: "passthrough" },
          retry: { maxAttempts: 1, backoffMs: DEFAULT_FLOW_STEP_BACKOFF_MS },
          parallel: { group: "reviewers" },
        },
        {
          id: "review-b",
          name: "Review B",
          identity: "reviewerB",
          dependsOn: ["start"],
          input: { source: FlowInputSource.STEP, stepId: "start", transform: "passthrough" },
          retry: { maxAttempts: 1, backoffMs: DEFAULT_FLOW_STEP_BACKOFF_MS },
          parallel: { group: "reviewers" },
        },
        {
          id: "merge",
          name: "Merge",
          identity: "merger",
          dependsOn: ["review-a", "review-b"],
          input: { source: FlowInputSource.REQUEST, transform: "passthrough" },
          retry: { maxAttempts: 1, backoffMs: DEFAULT_FLOW_STEP_BACKOFF_MS },
          mergeFromGroups: ["reviewers"],
        },
      ],
      output: { from: "merge", format: FlowOutputFormat.MARKDOWN },
      settings: { maxParallelism: 4, failFast: false },
    };

    // First run: reviewerA succeeds, reviewerB fails, merge fails (not all members succeeded)
    const firstRunExecutor = new ScriptedAgentExecutor({
      starter: ["start result"],
      reviewerA: ["review A output"],
      reviewerB: [new Error("reviewer B failed")],
      merger: ["merge result"],
    });
    const firstRunLogger = new RecordingFlowLogger();
    const firstRunRunner = new FlowRunner({
      agentExecutor: firstRunExecutor,
      eventLogger: firstRunLogger,
      config,
    });

    const firstResult = await firstRunRunner.execute(flow as IFlow, {
      userPrompt: "run parallel group",
      traceId,
      requestId,
    });

    // First run should fail (one group member failed)
    assertEquals(firstResult.success, false);
    assertEquals(firstResult.stepResults.get("review-a")?.success, true);
    assertEquals(firstResult.stepResults.get("review-b")?.success, false);

    // Checkpoint should exist and contain review-a
    assertEquals(await exists(checkpointPath), true);
    const checkpointRaw = await Deno.readTextFile(checkpointPath);
    const checkpoint = JSON.parse(checkpointRaw) as {
      completedSteps: Record<string, { stepId: string; success: boolean }>;
    };
    assertEquals(typeof checkpoint.completedSteps["review-a"], "object");
    assertEquals(typeof checkpoint.completedSteps["review-b"], "undefined");

    // Resume: reviewerB should NOT re-run (already failed and captured), reviewerA also should not re-run
    const resumedExecutor = new ScriptedAgentExecutor({
      starter: [new Error("starter should not re-run")],
      reviewerA: [new Error("reviewer A should not re-run")],
      reviewerB: [new Error("reviewer B should not re-run")],
      merger: ["merged on resume"],
    });
    const resumedLogger = new RecordingFlowLogger();
    const resumedRunner = new FlowRunner({
      agentExecutor: resumedExecutor,
      eventLogger: resumedLogger,
      config,
    });

    // The flow will fail again because reviewerB is still in failed state
    const resumedResult = await resumedRunner.execute(flow as IFlow, {
      userPrompt: "resume parallel group",
      traceId,
      requestId,
    });

    // Resume should NOT have re-run starter or reviewerA (they were checkpointed)
    assertEquals(resumedExecutor.calls.includes("starter"), false);
    assertEquals(resumedExecutor.calls.includes("reviewerA"), false);
    // reviewerB SHOULD be re-run because it failed and was not checkpointed
    assertEquals(resumedExecutor.calls.includes("reviewerB"), true);

    // Checkpoint should have been loaded
    assertEquals(
      resumedLogger.events.some((entry) => entry.event === FLOW_EVENT_CHECKPOINT_LOADED),
      true,
    );

    // review-a should still be successful from the first run
    const restoredReviewA = resumedResult.stepResults.get("review-a");
    assertExists(restoredReviewA);
    assertEquals(restoredReviewA.success, true);
  } finally {
    await cleanup();
  }
});
