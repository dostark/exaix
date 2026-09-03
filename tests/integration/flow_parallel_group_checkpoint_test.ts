/**
 * @module ParallelGroupCheckpointTest
 * @path tests/integration/flow_parallel_group_checkpoint_test.ts
 * @description Verifies checkpoint persistence and resume behavior for parallel group members.
 * @architectural-layer Tests
 * @related-files [packages/flow/src/flow_runner.ts, packages/flow/mod.ts]
 */

import { assertEquals, assertExists } from "@std/assert";
import { exists } from "@std/fs";
import { join } from "@std/path";
import type { IFlow, IFlowInput } from "@exaix/schemas/flow.ts";
import { FLOW_EVENT_CHECKPOINT_LOADED } from "@exaix/core";
import { initTestDbService } from "@exaix/testing";
import { createParallelGroupFlow, createScriptedFlowRunner } from "../helpers/parallel_group_flow_test_helper.ts";

Deno.test("[Step65.4] FlowRunner checkpoint captures individual parallel group members and resumes without re-running", async () => {
  const { config, tempDir, cleanup } = await initTestDbService();

  try {
    const traceId = "trace-parallel-group-checkpoint";
    const requestId = "req-parallel-group-checkpoint";
    const checkpointPath = join(tempDir, "Memory", "Execution", traceId, "checkpoint.json");

    const flow: IFlowInput = createParallelGroupFlow({
      flowId: "parallel-group-checkpoint-flow",
      flowName: "Parallel Group Checkpoint Flow",
      description: "Verify checkpoint captures individual group members and resume skips completed",
      groupId: "reviewers",
      memberSteps: [
        { stepId: "review-a", stepName: "Review A", agentRole: "reviewerA" },
        { stepId: "review-b", stepName: "Review B", agentRole: "reviewerB" },
      ],
    });

    // First run: reviewerA succeeds, reviewerB fails, merge fails (not all members succeeded)
    const { runner: firstRunRunner } = createScriptedFlowRunner(config, {
      starter: ["start result"],
      reviewerA: ["review A output"],
      reviewerB: [new Error("reviewer B failed")],
      merger: ["merge result"],
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
    const { executor: resumedExecutor, logger: resumedLogger, runner: resumedRunner } = createScriptedFlowRunner(
      config,
      {
        starter: [new Error("starter should not re-run")],
        reviewerA: [new Error("reviewer A should not re-run")],
        reviewerB: [new Error("reviewer B should not re-run")],
        merger: ["merged on resume"],
      },
    );

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
