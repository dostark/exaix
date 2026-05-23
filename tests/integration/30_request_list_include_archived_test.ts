/**
 * @module RequestListIncludeArchivedTest
 * @path tests/integration/30_request_list_include_archived_test.ts
 * @description Verifies that the 'request list --all' command correctly includes
 * archived and rejected requests.
 */

import { assert, assertEquals } from "@std/assert";
import { TestEnvironment } from "./helpers/test_environment.ts";
import { RequestListHandler } from "../../apps/exactl/src/handlers/request_list_handler.ts";

Deno.test("Integration: Request List - includes archived when requested", async () => {
  const env = await TestEnvironment.create({ initGit: true });

  try {
    // 1. Setup: Create 3 requests with different end states
    // A. Active request
    const { traceId: traceActive } = await env.createRequest("Active task");

    // B. Completed request (in Archive)
    const { traceId: traceCompleted, filePath: pathCompleted } = await env.createRequest("Completed task");
    const idCompleted = pathCompleted.split("/").pop()!.replace(".md", "");

    // C. Failed request (in Rejected)
    const { traceId: traceFailed, filePath: pathFailed } = await env.createRequest("Failed task");
    const idFailed = pathFailed.split("/").pop()!.replace(".md", "");

    // 2. Perform execution/archiving simulation
    const loop = env.createExecutionLoop();

    // Simulate Success for B
    const planB = await env.createPlan(traceCompleted, idCompleted, { status: "approved" });
    await loop.processTask(planB);

    // Simulate Failure for C
    const planC = await env.createPlan(traceFailed, idFailed, { status: "approved" });
    await env.injectFailureMarker(planC);
    await loop.processTask(planC);

    // 3. Test: List without --all (should only show 'Active task')
    const handler = new RequestListHandler(env.getContext());
    const activeOnly = await handler.list();
    assertEquals(activeOnly.length, 1, "Should only show one active request");
    assertEquals(activeOnly[0].trace_id, traceActive);

    // 4. Test: List with --all (should show all 3)
    const allRequests = await handler.list(undefined, true);
    assertEquals(allRequests.length, 3, "Should show all 3 requests with --all flag");

    const traceIds = allRequests.map((r: { trace_id: string }) => r.trace_id);
    assert(traceIds.includes(traceActive));
    assert(traceIds.includes(traceCompleted));
    assert(traceIds.includes(traceFailed));
  } finally {
    await env.cleanup();
  }
});
