/**
 * @module ParallelGroupRecoveryTest
 * @path tests/integration/43_parallel_group_recovery_test.ts
 * @description Verifies failed parallel group member recovery does not corrupt sibling results.
 * @architectural-layer Tests
 * @related-files [src/flows/flow_runner.ts, packages/flow-storage/mod.ts]
 */

import { assertEquals, assertExists } from "@std/assert";
import type { IFlow, IFlowInput } from "@exaix/schemas/flow.ts";
import { FLOW_EVENT_PARALLEL_GROUP_COMPLETED } from "@exaix/core";
import { initTestDbService } from "../helpers/db.ts";
import { createParallelGroupFlow, createScriptedFlowRunner } from "../helpers/parallel_group_flow_test_helper.ts";

Deno.test("[Step65.4] FlowRunner recovery preserves successful sibling results when a group member fails", async () => {
  const { config, cleanup } = await initTestDbService();

  try {
    const traceId = "trace-parallel-group-recovery";
    const requestId = "req-parallel-group-recovery";

    const flow: IFlowInput = createParallelGroupFlow({
      flowId: "parallel-group-recovery-flow",
      flowName: "Parallel Group Recovery Flow",
      description: "Recovery should preserve successful sibling results",
      groupId: "workers",
      memberSteps: [
        { stepId: "task-a", stepName: "Task A", identityId: "workerA" },
        { stepId: "task-b", stepName: "Task B", identityId: "workerB" },
        { stepId: "task-c", stepName: "Task C", identityId: "workerC" },
      ],
    });

    // First run: taskA and taskC succeed, taskB fails
    const { logger: firstRunLogger, runner: firstRunRunner } = createScriptedFlowRunner(config, {
      starter: ["start result"],
      workerA: ["task A output"],
      workerB: [new Error("task B failed")],
      workerC: ["task C output"],
      merger: ["merge result"],
    });

    const firstResult = await firstRunRunner.execute(flow as IFlow, {
      userPrompt: "run parallel group",
      traceId,
      requestId,
    });

    // Verify individual results
    assertEquals(firstResult.stepResults.get("task-a")?.success, true);
    assertEquals(firstResult.stepResults.get("task-b")?.success, false);
    assertEquals(firstResult.stepResults.get("task-c")?.success, true);

    // Parallel group should have completed with 1 failure
    const completedEvent = firstRunLogger.events.find(
      (entry) => entry.event === FLOW_EVENT_PARALLEL_GROUP_COMPLETED,
    );
    assertExists(completedEvent);
    assertEquals(completedEvent.payload.groupId, "workers");
    assertEquals(completedEvent.payload.successCount, 2);
    assertEquals(completedEvent.payload.failureCount, 1);

    // Resume: starter, workerA, and workerC should NOT re-run (they were checkpointed)
    // workerB SHOULD re-run because it failed and was not checkpointed
    const { executor: resumedExecutor, runner: resumedRunner } = createScriptedFlowRunner(config, {
      starter: [new Error("starter should not re-run")],
      workerA: [new Error("worker A should not re-run")],
      workerB: ["worker B recovered output"],
      workerC: [new Error("worker C should not re-run")],
      merger: ["merged on resume"],
    });

    const resumedResult = await resumedRunner.execute(flow as IFlow, {
      userPrompt: "resume parallel group",
      traceId,
      requestId,
    });

    // Starter, workerA, and workerC should NOT have been called (checkpointed)
    assertEquals(resumedExecutor.calls.includes("starter"), false);
    assertEquals(resumedExecutor.calls.includes("workerA"), false);
    assertEquals(resumedExecutor.calls.includes("workerC"), false);
    // workerB SHOULD have been called (it failed and was not checkpointed)
    assertEquals(resumedExecutor.calls.includes("workerB"), true);

    // Sibling results should still be present and successful from first run
    assertEquals(resumedResult.stepResults.get("task-a")?.success, true);
    assertEquals(resumedResult.stepResults.get("task-b")?.success, true);
    assertEquals(resumedResult.stepResults.get("task-c")?.success, true);

    // Group merge should now succeed (all members succeeded across runs)
    assertEquals(resumedResult.success, true);
    const mergeResult = resumedResult.stepResults.get("merge");
    assertExists(mergeResult);
    assertEquals(mergeResult.success, true);
  } finally {
    await cleanup();
  }
});
