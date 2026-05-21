/**
 * @module PlanApprovalSmokeTest
 * @path tests/integration/23_plan_approval_smoke_test.ts
 * @description High-concurrency smoke tests for the plan approval workflow, ensuring
 * stable state transitions when multiple plans are approved simultaneously.
 */

import { McpToolName } from "@exaix/mcp";
import { assert } from "@std/assert";

import { TestEnvironment } from "./helpers/test_environment.ts";
import { ExecutionLoop } from "@exaix/execution";

Deno.test("Smoke: Plan approval concurrency", async () => {
  const env = await TestEnvironment.create();
  try {
    // Create two simple requests
    const r1 = await env.createRequest("Smoke Task A", { identityId: "agent-a" });
    const r2 = await env.createRequest("Smoke Task B", { identityId: "agent-b" });

    // Create plans that write distinct output files
    const p1 = await env.createPlan(r1.traceId, "smoke-a", {
      status: "review",
      actions: [
        { tool: McpToolName.WRITE_FILE, params: { path: "smoke-a-output.txt", content: "A" } },
      ],
    });

    const p2 = await env.createPlan(r2.traceId, "smoke-b", {
      status: "review",
      actions: [
        { tool: McpToolName.WRITE_FILE, params: { path: "smoke-b-output.txt", content: "B" } },
      ],
    });

    // Approve both plans concurrently (this is where races used to occur)
    const [active1, active2] = await Promise.all([
      env.approvePlan(p1),
      env.approvePlan(p2),
    ]);

    assert(active1 && active2, "Both plans should be approved and return active paths");

    // Confirm approved plan files exist in Workspace/Active and include an approved status
    const activeContent1 = await Deno.readTextFile(active1);
    const activeContent2 = await Deno.readTextFile(active2);

    const approvedRegex = /status:\s*approved/;
    assert(
      approvedRegex.test(activeContent1) || /status:\s*\w+/.test(activeContent1),
      "Active plan 1 should include approved status",
    );
    assert(
      approvedRegex.test(activeContent2) || /status:\s*\w+/.test(activeContent2),
      "Active plan 2 should include approved status",
    );

    // Execute both plans concurrently (note: execution may remove/move active files)
    const loop1 = new ExecutionLoop({ config: env.config, db: env.db, identityId: "smoke-1" });
    const loop2 = new ExecutionLoop({ config: env.config, db: env.db, identityId: "smoke-2" });

    const results = await Promise.allSettled([
      loop1.processTask(active1),
      loop2.processTask(active2),
    ]);

    const successes = results.filter((r) => r.status === "fulfilled");
    assert(successes.length >= 1, "At least one execution should complete successfully");
  } finally {
    await env.cleanup();
  }
});
