/**
 * @module PlanFailureHandlingRegressionTest
 * @path tests/integration/28_plan_failure_handling_regression_test.ts
 * @description Verifies that plan execution failures are handled correctly, moving
 * plans to the Rejected directory and updating the original request status.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { TestEnvironment } from "./helpers/test_environment.ts";
import { join } from "@std/path";
import { getWorkspaceRejectedDir } from "@exaix/testing";
import { ExecutionStatus } from "@exaix/core";
import { RequestListHandler } from "../../apps/exactl/src/handlers/request_list_handler.ts";

Deno.test("Integration: Plan Failure Handling - moves to Rejected and updates Request", async () => {
  const env = await TestEnvironment.create({ initGit: true });

  try {
    // 1. Setup: Create a request and an approved plan
    const { filePath: requestPath, traceId } = await env.createRequest("Task that will fail");
    const requestId = requestPath.split("/").pop()!.replace(".md", "");

    // Create plan in Active folder (simulating approved plan ready for execution)
    const planPath = await env.createPlan(traceId, requestId, { status: "approved" });
    const approvedPlanPath = await env.approvePlan(planPath);

    // 2. Inject failure marker to trigger intentional failure in ExecutionLoop
    await env.injectFailureMarker(approvedPlanPath);

    // 3. Run execution loop
    const loop = env.createExecutionLoop();
    const result = await loop.processTask(approvedPlanPath);

    assertEquals(result.success, false, "Execution should fail due to failure marker");

    // 4. Verify Plan file moved to Rejected/ with _failed.md suffix
    const rejectedDir = getWorkspaceRejectedDir(env.tempDir);
    const expectedFailedPlan = join(rejectedDir, `${requestId}_plan_failed.md`);

    const failedPlanExists = await Deno.stat(expectedFailedPlan).then(() => true).catch(() => false);
    assert(failedPlanExists, `Failed plan should exist at ${expectedFailedPlan}`);

    const failedPlanContent = await Deno.readTextFile(expectedFailedPlan);
    assertStringIncludes(failedPlanContent, "status: error");
    assertStringIncludes(failedPlanContent, 'error: "Simulated execution failure"');

    // 5. Verify Original Request status updated to 'failed' and moved to Rejected/
    const expectedFailedRequest = join(rejectedDir, `${requestId}.md`);
    const failedRequestExists = await Deno.stat(expectedFailedRequest).then(() => true).catch(() => false);
    assert(failedRequestExists, `Failed request should exist at ${expectedFailedRequest}`);

    const updatedRequestContent = await Deno.readTextFile(expectedFailedRequest);
    assertStringIncludes(updatedRequestContent, `status: ${ExecutionStatus.FAILED}`);

    // 6. Verify RequestListHandler inbox is now empty (archived requests are moved out)
    const handler = new RequestListHandler(env.getContext());
    const requests = await handler.list();

    assertEquals(requests.length, 0, "Inbox should be empty after request is archived on failure");
  } finally {
    await env.cleanup();
  }
});
