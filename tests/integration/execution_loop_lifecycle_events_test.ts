/**
 * @module ExecutionLoopLifecycleEventsTest
 * @path tests/integration/execution_loop_lifecycle_events_test.ts
 * @description Integration tests verifying ExecutionLoop's execution.started and
 * execution.completed events fire with real, field-level payload values on a real
 * happy-path execution — using TestEnvironment.getActivityLog() (a real EventLogger
 * over a real SQLite db), never a mock or presence-only check. Canonical pattern for
 * Phase 169 (@visible Event Runtime Verification): Steps 2-8 reference this file's
 * construction style rather than re-explaining it.
 */

import { assert, assertEquals, assertExists } from "@std/assert";
import type { IActivityRecord } from "@exaix/core/types";
import { TestEnvironment } from "./helpers/test_environment.ts";

Deno.test("Integration: ExecutionLoop Lifecycle Events - execution.started and execution.completed fire with real payloads", async (t) => {
  const env = await TestEnvironment.create({ initGit: true });

  try {
    let traceId: string;
    let requestId: string;
    let activities: IActivityRecord[];

    await t.step("Setup: create and approve a happy-path plan, then execute it", async () => {
      const { filePath: requestPath, traceId: newTraceId } = await env.createRequest(
        "Task that will succeed",
      );
      traceId = newTraceId;
      requestId = requestPath.split("/").pop()!.replace(".md", "");

      const planPath = await env.createPlan(traceId, requestId, { status: "approved" });
      const approvedPlanPath = await env.approvePlan(planPath);

      const loop = env.createExecutionLoop();
      const result = await loop.processTask(approvedPlanPath);
      assertEquals(result.success, true, "Execution should succeed on a happy-path plan");

      activities = await env.getActivityLog(traceId);
    });

    await t.step("execution.started fires with real, field-level payload", () => {
      const executionStarted = activities.find((a) => a.action_type === "execution.started");
      assertExists(executionStarted, "execution.started must be emitted when execution begins");

      const payload = JSON.parse(executionStarted.payload);
      assertEquals(
        payload.request_id,
        requestId,
        "execution.started payload.request_id should match the real request id",
      );
      assert(
        typeof payload.plan_path === "string" && payload.plan_path.length > 0,
        "execution.started payload.plan_path should be a non-empty string",
      );
    });

    await t.step(
      "execution.completed fires with real, field-level payload (first real coverage of this event)",
      () => {
        const executionCompleted = activities.find((a) => a.action_type === "execution.completed");
        assertExists(
          executionCompleted,
          "execution.completed must be emitted for the first time on a happy-path execution",
        );

        const payload = JSON.parse(executionCompleted.payload);
        assertEquals(
          payload.request_id,
          requestId,
          "execution.completed payload.request_id should match the real request id",
        );
        assert(
          typeof payload.archived_to === "string" && payload.archived_to.endsWith(`${requestId}_plan.md`),
          "execution.completed payload.archived_to should point at the archived plan file",
        );
      },
    );
  } finally {
    await env.cleanup();
  }
});
