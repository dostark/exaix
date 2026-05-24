/**
 * @module RequestArchivingOnSuccessTest
 * @path tests/integration/29_request_archiving_on_success_test.ts
 * @description Verifies that original request files are moved to the Archive directory
 * and marked as completed when execution succeeds.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { TestEnvironment } from "./helpers/test_environment.ts";
import { join } from "@std/path";
import { getWorkspaceArchiveDir } from "@exaix/testing";
import { ExecutionStatus } from "@exaix/core";

Deno.test("Integration: Request Archiving - moves to Archive on success", async () => {
  const env = await TestEnvironment.create({ initGit: true });

  try {
    // 1. Setup: Create a request and an approved plan
    const { filePath: requestPath, traceId } = await env.createRequest("Task that will succeed");
    const requestId = requestPath.split("/").pop()!.replace(".md", "");

    // Create plan in Active folder
    const planPath = await env.createPlan(traceId, requestId, { status: "approved" });
    const approvedPlanPath = await env.approvePlan(planPath);

    // 2. Run execution loop (Success by default in test env unless marker injected)
    const loop = env.createExecutionLoop();
    const result = await loop.processTask(approvedPlanPath);

    assertEquals(result.success, true, "Execution should succeed");

    // 3. Verify Plan file moved to Archive/
    const archiveDir = getWorkspaceArchiveDir(env.tempDir);
    const expectedArchivedPlan = join(archiveDir, `${requestId}_plan.md`);
    const planExists = await Deno.stat(expectedArchivedPlan).then(() => true).catch(() => false);
    assert(planExists, "Plan should be archived");

    // 4. Verify Request file moved to Archive/
    const expectedArchivedRequest = join(archiveDir, `${requestId}.md`);
    const requestExists = await Deno.stat(expectedArchivedRequest).then(() => true).catch(() => false);
    assert(requestExists, `Request should be archived at ${expectedArchivedRequest}`);

    // 5. Verify Archived Request status is 'completed'
    const archivedRequestContent = await Deno.readTextFile(expectedArchivedRequest);
    assertStringIncludes(archivedRequestContent, `status: ${ExecutionStatus.COMPLETED}`);
  } finally {
    await env.cleanup();
  }
});
