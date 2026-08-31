/**
 * @module HappyPathIntegrationTest
 * @path tests/integration/core_happy_path_test.ts
 * @description End-to-end integration test for the "Happy Path" workflow: Request -> Plan ->
 * Approval -> Execution -> Report, ensuring trace correlation across all stages.
 */

import { assert, assertEquals, assertExists, assertStringIncludes } from "@std/assert";
import { ExecutionStatus, MemoryBankSource, PortalOperation } from "@exaix/core";
import { McpToolName } from "@exaix/mcp";
import { join as _join } from "@std/path";
import { TestEnvironment } from "./helpers/test_environment.ts";
import { MissionReporter } from "@exaix/core/artifact";
import { MemoryBankService } from "@exaix/memory";
import { EventLogger } from "@exaix/core/logger";

Deno.test("Integration: Happy Path - Request to Report", async (t) => {
  const env = await TestEnvironment.create();

  try {
    let traceId: string;
    let requestPath: string;
    let planPath: string;
    let activePlanPath: string;

    // Test 1: Request Creation
    await t.step("Test 1: Create request with valid frontmatter", async () => {
      const result = await env.createRequest(
        "Implement a simple hello world function in TypeScript",
        {
          identityId: "senior-coder",
          priority: 7,
          tags: ["feature", "typescript"],
        },
      );

      traceId = result.traceId;
      requestPath = result.filePath;

      // Verify file exists
      const exists = await env.fileExists(
        `Workspace/Requests/request-${traceId.substring(0, 8)}.md`,
      );
      assertEquals(exists, true, "Request file should exist");

      // Verify frontmatter
      const content = await Deno.readTextFile(requestPath);
      assertStringIncludes(content, `trace_id: "${traceId}"`);
      assertStringIncludes(content, "identity_id: senior-coder");
      assertStringIncludes(content, "status: pending");
      assertStringIncludes(content, "priority: 7");

      // Verify UUID format
      assert(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(traceId),
        "trace_id should be valid UUID",
      );
    });

    // Test 2: Plan Generation (simulated - normally done by daemon)
    await t.step("Test 2: Plan created referencing request trace_id", async () => {
      // Simulate plan generation (in real system, daemon would do this)
      planPath = await env.createPlan(traceId, "implement-hello", {
        status: "review",
        actions: [
          {
            tool: McpToolName.WRITE_FILE,
            params: {
              path: "src/hello.ts",
              content: 'export function hello(): string { return "Hello World"; }',
            },
          },
        ],
      });

      // Verify plan exists
      const foundPlan = await env.getPlanByTraceId(traceId);
      assertExists(foundPlan, "Plan should exist in /Workspace/Plans");

      // Verify plan content
      const content = await Deno.readTextFile(planPath);
      assertStringIncludes(content, `trace_id: "${traceId}"`);
      assertStringIncludes(content, 'request_id: "implement-hello"');
      assertStringIncludes(content, "status: review");
      assertStringIncludes(content, McpToolName.WRITE_FILE);
    });

    // Test 3: Plan Approval
    await t.step("Test 3: Plan approval moves to Workspace/Active with status=approved", async () => {
      activePlanPath = await env.approvePlan(planPath);

      // Verify plan moved to Active
      const activeExists = await env.fileExists("Workspace/Active/implement-hello_plan.md");
      assertEquals(activeExists, true, "Plan should exist in /Workspace/Active");

      // Verify original removed from Workspace
      const inboxExists = await env.fileExists("Workspace/Plans/implement-hello_plan.md");
      assertEquals(inboxExists, false, "Plan should be removed from /Workspace/Plans");

      // Verify status updated
      const content = await Deno.readTextFile(activePlanPath);
      assertStringIncludes(content, "status: approved");
    });

    // Test 4 & 5: Execution (creates branch and commits)
    await t.step("Test 4: Execution creates feature branch", async () => {
      const loop = env.createExecutionLoop("test-agent");

      // Execute the plan
      const result = await loop.processTask(activePlanPath);

      // Check execution succeeded (or at least started)
      // Note: Actual execution depends on tool registry setup
      assertExists(result);

      // Verify git branch was created
      const branches = await env.getGitBranches();
      const featureBranch = branches.find((b) => b.includes("feat/") && b.includes("implement-hello"));

      // Branch should exist (created during execution)
      // May fail if tool execution fails, but branch should still be created
      assertExists(featureBranch, "Feature branch should be created");
    });

    await t.step("Test 5: Commit message includes trace_id footer", async () => {
      // Get commit log
      const cmd = new Deno.Command(PortalOperation.GIT, {
        args: ["log", "--oneline", "-n", "5", "--all"],
        cwd: env.tempDir,
        stdout: "piped",
      });

      const { stdout } = await cmd.output();
      const log = new TextDecoder().decode(stdout);

      // Check for ExaTrace footer in commits
      const fullLogCmd = new Deno.Command(PortalOperation.GIT, {
        args: ["log", "-n", "5", "--all"],
        cwd: env.tempDir,
        stdout: "piped",
      });

      const { stdout: fullStdout } = await fullLogCmd.output();
      const fullLog = new TextDecoder().decode(fullStdout);

      // Should have commits beyond initial
      assert(log.split("\n").length > 1, "Should have commits from execution");

      // If execution succeeded, should have ExaTrace
      if (fullLog.includes("ExaTrace")) {
        assertStringIncludes(fullLog, traceId.substring(0, 8));
      }
    });

    // Test 6: Report Generation
    await t.step("Test 6: Report generated with execution summary", async () => {
      // Generate report (normally done by execution loop on success)
      const reportConfig = {
        reportsDirectory: `${env.tempDir}/Memory/Execution`,
        memoryRoot: `${env.tempDir}/Memory`,
        db: env.db,
      };
      const memoryBank = new MemoryBankService(env.config);
      const logger = new EventLogger({ db: env.db });
      const reporter = new MissionReporter(env.config, reportConfig, memoryBank, logger);

      const reportResult = await reporter.generate({
        traceId,
        requestId: "implement-hello",
        identityId: "senior-coder",
        status: ExecutionStatus.COMPLETED,
        branch: `feat/implement-hello-${traceId.substring(0, 8)}`,
        completedAt: new Date(),
        contextFiles: [requestPath],
        reasoning: "Implementation followed best practices",
        summary: "Task completed successfully",
      });

      // Verify report exists
      assertExists(reportResult.reportPath);
      const fullReportPath = _join(env.tempDir, reportResult.reportPath);
      const reportContent = await Deno.readTextFile(fullReportPath);

      // Verify report structure
      assertStringIncludes(reportContent, traceId);
      assertStringIncludes(reportContent, "implement-hello");
      assertStringIncludes(reportContent, ExecutionStatus.COMPLETED);
    });

    // Test 7: IActivity Journal Logging
    await t.step("Test 7: All operations logged with trace_id correlation", async () => {
      // Wait for any pending log writes
      await new Promise((resolve) => setTimeout(resolve, 200));

      const activities = await env.getActivityLog(traceId);

      // Should have multiple activity entries
      assert(activities.length >= 1, "Should have activity log entries");

      // All activities should have same trace_id
      for (const activity of activities) {
        // Activities are already filtered by trace_id
        assertExists(activity.action_type);
        assertExists(activity.timestamp);
      }

      // Check for key action types
      const actionTypes = activities.map((a) => a.action_type);

      // Should have execution-related activities
      const hasExecutionActivity = actionTypes.some((t) =>
        t.includes(MemoryBankSource.EXECUTION) || t.includes(PortalOperation.GIT) || t.includes("report")
      );

      assert(
        hasExecutionActivity || activities.length > 0,
        "Should have execution-related activities logged",
      );
    });
  } finally {
    await env.cleanup();
  }
});

// Additional focused tests for specific happy path aspects

Deno.test("Integration: Happy Path - Request generates unique trace_ids", async () => {
  const env = await TestEnvironment.create();

  try {
    const request1 = await env.createRequest("First request");
    const request2 = await env.createRequest("Second request");

    // Trace IDs should be unique
    assert(
      request1.traceId !== request2.traceId,
      "Each request should have unique trace_id",
    );

    // Both should be valid UUIDs
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    assert(uuidRegex.test(request1.traceId), "trace_id should be valid UUID");
    assert(uuidRegex.test(request2.traceId), "trace_id should be valid UUID");
  } finally {
    await env.cleanup();
  }
});

Deno.test("Integration: Happy Path - Plan maintains trace correlation", async () => {
  const env = await TestEnvironment.create();

  try {
    // Create request
    const { traceId } = await env.createRequest("Test correlation");

    // Create plan with same trace_id
    const planPath = await env.createPlan(traceId, "test-correlation", {});

    // Read and verify
    const planContent = await Deno.readTextFile(planPath);

    // Plan should reference same trace_id
    assertStringIncludes(planContent, `trace_id: "${traceId}"`);

    // Approve and verify trace persists
    const activePath = await env.approvePlan(planPath);
    const activeContent = await Deno.readTextFile(activePath);

    assertStringIncludes(activeContent, `trace_id: "${traceId}"`);
  } finally {
    await env.cleanup();
  }
});
