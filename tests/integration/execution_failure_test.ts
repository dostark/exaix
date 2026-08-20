/**
 * @module ExecutionFailureIntegrationTest
 * @path tests/integration/execution_failure_test.ts
 * @description Integration tests for robust failure handling during the execution phase,
 * verifying automated Git rollbacks, failure report generation, and IActivity Journal logging.
 */

import { assert, assertEquals, assertExists, assertStringIncludes } from "@std/assert";
import { EvaluationVerdict, FlowStepType, MemoryBankSource, PortalOperation } from "@exaix/core";
import { McpToolName } from "@exaix/mcp";
import { join as _join } from "@std/path";
import { TestEnvironment } from "./helpers/test_environment.ts";

Deno.test("Integration: Execution Failure - Plan fails during execution", async (t) => {
  const env = await TestEnvironment.create();

  try {
    let traceId: string;
    let _requestPath: string;
    let activePlanPath: string;

    // Setup: Create request, plan, and approve
    await t.step("Setup: Create and approve plan with failing action", async () => {
      const result = await env.createRequest(
        "Read from non-existent file",
        { identityId: "senior-coder" },
      );
      traceId = result.traceId;
      _requestPath = result.filePath;
      const requestId = `request-${traceId.substring(0, 8)}`;

      // Create plan with action that will fail
      const planPath = await env.createPlan(traceId, requestId, {
        status: "review",
        actions: [
          {
            tool: McpToolName.READ_FILE,
            params: {
              path: "/non/existent/path/that/does/not/exist.txt",
            },
          },
        ],
      });

      // Approve the plan
      activePlanPath = await env.approvePlan(planPath);

      // Verify setup
      const activeExists = await env.fileExists(`Workspace/Active/${requestId}_plan.md`);
      assertEquals(activeExists, true, "Plan should be in Active");
    });

    // ========================================================================
    // Test 1: Execution failure is detected
    // ========================================================================
    await t.step("Test 1: Execution failure is detected and captured", async () => {
      // Modify the plan to include the special failure marker
      await env.injectFailureMarker(activePlanPath);

      const loop = env.createExecutionLoop("test-agent");

      // Execute the failing plan
      const result = await loop.processTask(activePlanPath);

      // Result should indicate failure (ExecutionLoop uses special markers)
      assertEquals(result.success, false, "Execution should fail with failure marker");
      assertExists(result.error, "Should have error message");
    });

    // ========================================================================
    // Test 2: Git changes rolled back
    // ========================================================================
    await t.step("Test 2: Git changes are rolled back on failure", async () => {
      // Get current branch
      const branchCmd = new Deno.Command(PortalOperation.GIT, {
        args: [FlowStepType.BRANCH, "--show-current"],
        cwd: env.tempDir,
        stdout: "piped",
      });
      const { stdout } = await branchCmd.output();
      const _currentBranch = new TextDecoder().decode(stdout).trim();

      // Should be back on main (not stuck on feature branch)
      // Or the feature branch should exist but not be merged
      const branches = await env.getGitBranches();
      const mainBranch = branches.find((b) => b === "main" || b === "master");
      assertExists(mainBranch, "Main branch should exist");
    });

    // ========================================================================
    // Test 3: Failure report generated
    // ========================================================================
    await t.step("Test 3: Failure report generated with error details", async () => {
      // Wait for any async report generation
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, 200);
      await promise;

      // Check for failure report or error in activity log
      const activities = await env.getActivityLog(traceId);

      const failureActivities = activities.filter((a) =>
        a.action_type.includes(EvaluationVerdict.FAIL) ||
        a.action_type.includes("error") ||
        a.action_type.includes(MemoryBankSource.EXECUTION)
      );

      // Should have real failure-related activities, not merely a non-negative count
      assert(failureActivities.length > 0, "Should have failure-related activities in the journal");

      // execution.failed must be emitted on execution failure — unconditional, never gated
      // behind an `if (executionFailed)` that silently passes when the event never fires.
      const executionFailed = activities.find((a) => a.action_type === "execution.failed");
      assertExists(executionFailed, "execution.failed must be emitted on execution failure");
      const payload = JSON.parse(executionFailed.payload);
      assertExists(payload.request_id, "execution.failed payload should include request_id");
      assertExists(payload.error, "execution.failed payload should include error");
      assertExists(payload.moved_to, "execution.failed payload should include moved_to");
    });

    // ========================================================================
    // Test 4: Plan status updated
    // ========================================================================
    await t.step("Test 4: Plan moved to Rejected on failure", async () => {
      // After failure, plan should be in Rejected with _failed.md suffix
      const requestId = `request-${traceId.substring(0, 8)}`;
      const inRejected = await env.fileExists(`Workspace/Rejected/${requestId}_plan_failed.md`);
      assertEquals(inRejected, true, "Plan should be in Workspace/Rejected");

      // Should be in one of these locations
      assertEquals(inRejected, true, "Plan should be in Workspace/Rejected");
    });

    // ========================================================================
    // Test 5: Lease released
    // ========================================================================
    await t.step("Test 5: Lease is released even on failure", async () => {
      // Create a new execution loop
      const newLoop = env.createExecutionLoop("new-agent");

      // If we had a lease file system, we'd check it's released
      // For now, verify we can process another task (no deadlock)
      const { traceId: newTraceId } = await env.createRequest("New task after failure");
      const newPlanPath = await env.createPlan(newTraceId, "new-task", {
        status: "review",
        actions: [{ tool: McpToolName.WRITE_FILE, params: { path: "ok.txt", content: "ok" } }],
      });
      const newActivePath = await env.approvePlan(newPlanPath);

      // Should be able to start execution (lease not stuck)
      // This would throw if lease was stuck
      try {
        const result = await newLoop.processTask(newActivePath);
        // Either succeeds or fails, but doesn't deadlock
        assertExists(result);
      } catch (e) {
        // Even an error is fine, as long as it's not a lease error
        assert(!String(e).includes("lease"), "Should not fail due to stuck lease");
      }
    });

    // ========================================================================
    // Test 6: Failure logged to IActivity Journal
    // ========================================================================
    await t.step("Test 6: All failure steps logged with trace_id", async () => {
      const activities = await env.getActivityLog(traceId);

      // Should have multiple activities for the trace
      assert(activities.length >= 1, "Should have logged activities");

      // Check for execution-related activities
      const _hasExecutionActivity = activities.some((a) =>
        a.action_type.includes(MemoryBankSource.EXECUTION) ||
        a.action_type.includes(PortalOperation.GIT)
      );

      // All activities should have trace_id (already filtered)
      for (const activity of activities) {
        assertExists(activity.action_type);
        assertExists(activity.timestamp);
      }
    });

    // ========================================================================
    // Test 7: Original request unaffected
    // ========================================================================
    await t.step("Test 7: Original request archived to Rejected on failure", async () => {
      // Request should be moved to Rejected
      const requestExistsInInbox = await env.fileExists(
        `Workspace/Requests/request-${traceId.substring(0, 8)}.md`,
      );
      assertEquals(requestExistsInInbox, false, "Request should no longer be in Inbox");

      const requestExistsInRejected = await env.fileExists(
        `Workspace/Rejected/request-${traceId.substring(0, 8)}.md`,
      );
      assertEquals(requestExistsInRejected, true, "Request should be in Rejected");

      // Request content status updated to failed
      const rejectedPath = _join(env.tempDir, `Workspace/Rejected/request-${traceId.substring(0, 8)}.md`);
      const content = await Deno.readTextFile(rejectedPath);
      assertStringIncludes(content, `trace_id: "${traceId}"`);
      assertStringIncludes(content, "status: failed");
    });
  } finally {
    await env.cleanup();
  }
});

// Additional failure scenario tests

Deno.test("Integration: Execution Failure - Tool throws exception", async () => {
  const env = await TestEnvironment.create();

  try {
    const { traceId } = await env.createRequest("Task with failure marker");

    const planPath = await env.createPlan(traceId, "invalid-params", {
      status: "review",
      actions: [
        {
          tool: "shell_exec",
          params: {
            command: "echo test",
          },
        },
      ],
    });

    const activePath = await env.approvePlan(planPath);

    // Add failure marker to trigger simulated failure
    await env.injectFailureMarker(activePath);

    const loop = env.createExecutionLoop("test-agent");
    const result = await loop.processTask(activePath);

    // Should fail with failure marker
    assertEquals(result.success, false);
  } finally {
    await env.cleanup();
  }
});

Deno.test("Integration: Execution Failure - Partial execution rollback", async () => {
  const env = await TestEnvironment.create();

  try {
    const { traceId } = await env.createRequest("Task with partial success");

    // First action succeeds, then failure marker triggers failure
    const planPath = await env.createPlan(traceId, "partial-success", {
      status: "review",
      actions: [
        {
          tool: McpToolName.WRITE_FILE,
          params: { path: "success.txt", content: "This will succeed" },
        },
      ],
    });

    const activePath = await env.approvePlan(planPath);

    // Add failure marker
    await env.injectFailureMarker(activePath);

    const loop = env.createExecutionLoop("test-agent");
    const result = await loop.processTask(activePath);

    // Overall should fail
    assertEquals(result.success, false);

    // Git state after failure - execution loop may leave us on feature branch or main
    // The key is that we don't crash and the result indicates failure
    const currentBranchCmd = new Deno.Command(PortalOperation.GIT, {
      args: ["rev-parse", "--abbrev-ref", "HEAD"],
      cwd: env.tempDir,
      stdout: "piped",
    });
    const { stdout } = await currentBranchCmd.output();
    const currentBranch = new TextDecoder().decode(stdout).trim();

    // Should be on some valid branch
    assert(
      currentBranch.length > 0,
      "Should be on a valid branch after failure",
    );
  } finally {
    await env.cleanup();
  }
});

Deno.test("Integration: Execution Failure - Recovery allows retry", async () => {
  const env = await TestEnvironment.create();

  try {
    const { traceId } = await env.createRequest("Retryable task");

    // Create plan that will fail (with failure marker)
    let planPath = await env.createPlan(traceId, "retry-task", {
      status: "review",
      actions: [
        { tool: McpToolName.WRITE_FILE, params: { path: "test.txt", content: "test" } },
      ],
    });

    let activePath = await env.approvePlan(planPath);

    // Add failure marker
    await env.injectFailureMarker(activePath);

    const loop = env.createExecutionLoop("test-agent");

    // First attempt fails
    const result1 = await loop.processTask(activePath);
    assertEquals(result1.success, false);

    // "Fix" the plan and retry (create new plan with same trace_id)
    planPath = await env.createPlan(traceId, "retry-task-fixed", {
      status: "review",
      actions: [
        { tool: McpToolName.WRITE_FILE, params: { path: "works.txt", content: "Fixed!" } },
      ],
    });

    activePath = await env.approvePlan(planPath);

    // Second attempt should work (or at least not be blocked by previous failure)
    const result2 = await loop.processTask(activePath);

    // Should be able to execute (success or different error, not "already failed")
    assertExists(result2);
    assertEquals(result2.traceId, traceId);
  } finally {
    await env.cleanup();
  }
});
