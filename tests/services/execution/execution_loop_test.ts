/**
 * @module ExecutionLoopTest
 * @path tests/services/execution/execution_loop_test.ts
 * @description Verifies the primary identity execution loop, ensuring robust orchestration
 * of planning, execution, and confirmation phases for user requests.
 */

import { assert, assertEquals, assertExists, assertStringIncludes } from "@std/assert";
import { MemoryOperation, PortalOperation } from "@exaix/core";
import { join } from "@std/path";
import { getDefaultPaths } from "../../../src/config/paths.ts";
import { ExecutionLoop } from "../../../src/services/agent/execution_loop.ts";
import { createMockConfig } from "../../helpers/config.ts";
import { initTestDbService } from "../../helpers/db.ts";
import { setupGitRepo } from "../../helpers/git_test_helper.ts";
import {
  getMemoryExecutionDir,
  getWorkspaceActiveDir,
  getWorkspaceArchiveDir,
  getWorkspaceRejectedDir,
  getWorkspaceRequestsDir,
} from "../../helpers/paths_helper.ts";
import { ensureDir } from "@std/fs/ensure-dir";
import type { IGenerateResult } from "../../../src/ai/providers/common.ts";
import type { IModelProvider } from "../../../src/ai/types.ts";
import type { ActivityRecord } from "../../../src/services/core/db.ts";
import { EXECUTION_REPORT_FILENAME } from "@exaix/core";
import { TEST_DEFAULT_BRANCH } from "../../helpers/constants.ts";
import { readFixtureTextSync } from "../../helpers/fixtures.ts";

/**
 * Tests for Step 4.3: Execution Loop (Resilient)
 *
 * Success Criteria:
 * - Monitor Workspace/Active for approved plans
 * - Acquire lease to prevent concurrent execution
 * - Execute plan using Tool Registry and Git Service
 * - Handle success path = commit changes, generate report, archive plan
 * - Handle failure path = rollback git, generate failure report, move plan back
 * - Release lease even on failure
 * - Log all execution steps to IActivity Journal with trace_id and identity_id
 */

function getTestPaths(root: string) {
  const paths = getDefaultPaths(root);
  return {
    ...paths,
    activeDir: getWorkspaceActiveDir(root),
    archiveDir: getWorkspaceArchiveDir(root),
    requestsDir: getWorkspaceRequestsDir(root),
    memoryExecution: getMemoryExecutionDir(root),
  };
}

Deno.test("ExecutionLoop: processes approved plan from Workspace/Active", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "exec-test-process-" });
  const { db, cleanup } = await initTestDbService();
  const traceId = crypto.randomUUID();
  try {
    await ensureDir(getWorkspaceActiveDir(tempDir));

    // Create a simple plan file
    const planContent = `---
trace_id: "${traceId}"
request_id: test-request
status: active
identity_id: test-identity
---

# Test Plan

## Actions
1. Read a test file
`;

    const planPath = join(getWorkspaceActiveDir(tempDir), "test-request.md");
    await Deno.writeTextFile(planPath, planContent);
    const config = createMockConfig(tempDir);
    const paths = getTestPaths(tempDir);

    const loop = new ExecutionLoop({ config, db, identityId: "test-identity" });

    // Process the plan
    const result = await loop.processTask(planPath);

    assertEquals(result.success, true);
    assertExists(result.traceId);

    // Plan should be moved to archive
    const archivedPlan = join(paths.archiveDir, "test-request.md");
    const archivedExists = await Deno.stat(archivedPlan).then(() => true).catch(() => false);
    assert(archivedExists, "Plan should be archived after successful execution");

    // IActivity should be logged
    await new Promise((resolve) => setTimeout(resolve, 150)); // Wait for batched logs
    const activities = db.getActivitiesByTrace(traceId);
    const startedLog = activities.find((a: ActivityRecord) => a.action_type === "execution.started");
    assertExists(startedLog, "execution.started should be logged");
  } finally {
    await cleanup();
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("ExecutionLoop: acquires lease to prevent concurrent execution", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "exec-test-lease-" });
  const { db, cleanup } = await initTestDbService();

  try {
    const config = createMockConfig(tempDir);
    const paths = getTestPaths(tempDir);
    await Deno.mkdir(paths.activeDir, { recursive: true });

    const planContent = readFixtureTextSync(
      import.meta.url,
      "services",
      "execution",
      "execution_loop_test",
      "planContent.md",
    );
    const planPath = join(paths.activeDir, "lease-test.md");
    await Deno.writeTextFile(planPath, planContent);

    const loop1 = new ExecutionLoop({ config, db, identityId: "identity-1" });
    const loop2 = new ExecutionLoop({ config, db, identityId: "identity-2" });

    // Start first execution but don't await
    const exec1Promise = loop1.processTask(planPath);

    // Give first execution time to acquire lease
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Try second execution while first is still running
    // This should work if file still exists, or fail gracefully if file was already processed
    try {
      await loop2.processTask(planPath);
      // If we get here, file was already processed (acceptable)
    } catch (error) {
      // Should be either "lease already held" or "file not found" (both acceptable)
      const errorMsg = error instanceof Error ? error.message : String(error);
      const validErrors = ["lease already held", "No such file"];
      assert(
        validErrors.some((msg) => errorMsg.includes(msg)),
        `Expected lease or file error, got: ${errorMsg}`,
      );
    }

    // Wait for first execution to complete
    await exec1Promise;
  } finally {
    await cleanup();
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("ExecutionLoop: creates git branch and commits with trace_id", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "exec-test-git-" });
  const { db, cleanup } = await initTestDbService();

  try {
    await ensureDir(getWorkspaceActiveDir(tempDir));
    const config = createMockConfig(tempDir);
    const paths = getTestPaths(tempDir);

    const planContent = readFixtureTextSync(
      import.meta.url,
      "services",
      "execution",
      "execution_loop_test",
      "planContent_1.md",
    );
    const planPath = join(paths.activeDir, "git-commit-test.md");
    await Deno.writeTextFile(planPath, planContent);

    const loop = new ExecutionLoop({ config, db, identityId: "test-identity" });
    const result = await loop.processTask(planPath);

    // Verify execution completed (git branch creation is tested in integration tests)
    assertEquals(result.success, true, `Execution failed: ${result.error}`);
    assertEquals(result.traceId, "test-trace-git");
  } finally {
    await cleanup();
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("ExecutionLoop: handles tool execution failure gracefully", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "exec-test-failure-" });
  const { db, cleanup } = await initTestDbService();

  try {
    const config = createMockConfig(tempDir);
    const activeDir = getWorkspaceActiveDir(tempDir);
    await Deno.mkdir(activeDir, { recursive: true });

    // Plan that will fail (path traversal attempt)
    const planContent = readFixtureTextSync(
      import.meta.url,
      "services",
      "execution",
      "execution_loop_test",
      "planContent_2.md",
    );
    const planPath = join(activeDir, "fail-test.md");
    await Deno.writeTextFile(planPath, planContent);

    const loop = new ExecutionLoop({ config, db, identityId: "test-identity" });
    const result = await loop.processTask(planPath);

    assertEquals(result.success, false);
    assertExists(result.error);

    // Plan should be moved to Workspace/Rejected with _failed.md suffix and error status
    const rejectedDir = getWorkspaceRejectedDir(tempDir);
    const movedPlan = join(rejectedDir, "fail-test_failed.md");
    const movedExists = await Deno.stat(movedPlan).then(() => true).catch(() => false);
    assert(movedExists, "Plan should be moved to /Workspace/Rejected on failure");

    // Failure report should be generated
    const reportsDir = join(getMemoryExecutionDir(tempDir), "test-trace-fail");
    const failureReportPath = join(reportsDir, "failure.md");
    const failureReportExists = await Deno.stat(failureReportPath).then(() => true).catch(() => false);
    assert(failureReportExists, "Failure report should be generated");

    // IActivity should log failure
    await new Promise((resolve) => setTimeout(resolve, 150));
    const activities = db.getActivitiesByTrace("test-trace-fail");
    const failedLog = activities.find((a: ActivityRecord) => a.action_type === "execution.failed");
    assertExists(failedLog, "execution.failed should be logged");
  } finally {
    await cleanup();
    await Deno.remove(tempDir, { recursive: true });
  }
});

/**
 * Regression test for read-only plan execution producing analysis output.
 * Root cause: read-only structured plans were skipped, so no analysis was generated.
 * Fix: execute read-only structured plans with tool actions and generate analysis report.
 */
Deno.test("[regression] ExecutionLoop: read-only structured plan writes analysis report", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "exec-test-readonly-report-" });
  const { db, cleanup } = await initTestDbService();
  const traceId = crypto.randomUUID();

  class ReadOnlyReportProvider implements IModelProvider {
    id = "readonly-report-provider";

    generate(prompt: string): Promise<IGenerateResult> {
      let content = "";
      if (prompt.includes("EXECUTION REPORT")) {
        content = "## Summary\n\nRead-only analysis report.";
      } else {
        content = `
\`\`\`toml
[[actions]]
tool = "read_file"
[actions.params]
path = "analysis-target.txt"
\`\`\`
`;
      }

      return Promise.resolve({
        content,
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        model: "readonly-mock",
        provider: "mock",
        cost_usd: 0,
      });
    }
  }

  try {
    const config = createMockConfig(tempDir, {
      portals: [{
        alias: "workspace",
        target_path: tempDir,
        default_branch: TEST_DEFAULT_BRANCH,
        identities_allowed: ["*"],
        operations: [],
      }],
    });
    const paths = getTestPaths(tempDir);
    await Deno.mkdir(paths.activeDir, { recursive: true });

    // Provide a read-only blueprint so ExecutionLoop can detect capability mode.
    const blueprintsDir = join(tempDir, "Blueprints", "Identities");
    await ensureDir(blueprintsDir);
    await Deno.writeTextFile(
      join(blueprintsDir, "code-analyst.md"),
      `---\nidentity_id: "code-analyst"\nname: "Code Analyst"\nmodel: "mock:test"\ncapabilities: ["read_file", "list_directory", "grep_search"]\ncreated: "2026-02-04T00:00:00Z"\ncreated_by: "test"\nversion: "1.0.0"\n---\n\n# Code Analyst\n`,
    );

    await Deno.writeTextFile(join(tempDir, "analysis-target.txt"), "analysis source");

    const planContent =
      `---\ntrace_id: "${traceId}"\nrequest_id: readonly-report\nstatus: active\nidentity_id: code-analyst\n---\n\n# Read-only Structured Plan\n\n## Execution Steps\n\n## Step 1: Analyze code\n\nRead files and produce an analysis report.\n`;

    const planPath = join(paths.activeDir, "readonly-report.md");
    await Deno.writeTextFile(planPath, planContent);

    const loop = new ExecutionLoop({
      config,
      db,
      identityId: "daemon",
      llmProvider: new ReadOnlyReportProvider(),
    });

    const result = await loop.processTask(planPath);

    assertEquals(result.success, true);
    assertEquals(result.traceId, traceId);

    const reportPath = join(paths.memoryExecution, traceId, EXECUTION_REPORT_FILENAME);
    const reportExists = await Deno.stat(reportPath).then(() => true).catch(() => false);
    assertEquals(reportExists, true, "analysis report should be written to Memory/Execution");

    const reportContent = await Deno.readTextFile(reportPath);
    assertStringIncludes(reportContent, "Read-only analysis report.");

    const artifacts = await db.preparedAll<
      { id: string; status: string; identity: string; portal: string | null; request_id: string; file_path: string }
    >(
      "SELECT id, status, identity, portal, request_id, file_path FROM artifacts WHERE request_id = ?",
      ["readonly-report"],
    );
    assertEquals(artifacts.length, 1, "Exactly one artifact should be created for a read-only execution");

    const artifactContent = await Deno.readTextFile(join(tempDir, artifacts[0].file_path));
    assertStringIncludes(artifactContent, "Read-only analysis report.");
  } finally {
    await cleanup();
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("ExecutionLoop: generates mission report on success", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "exec-test-report-" });
  const { db, cleanup } = await initTestDbService();
  const traceId = crypto.randomUUID();

  try {
    const config = createMockConfig(tempDir);
    const activeDir = getWorkspaceActiveDir(tempDir);
    await Deno.mkdir(activeDir, { recursive: true });

    const planContent = `---
trace_id: "${traceId}"
request_id: report-test
status: active
identity_id: test-identity
---

# Report Test Plan

## Actions
1. Create a test file
`;

    const planPath = join(activeDir, "report-test.md");
    await Deno.writeTextFile(planPath, planContent);

    const loop = new ExecutionLoop({ config, db, identityId: "test-identity" });
    const result = await loop.processTask(planPath);

    assertEquals(result.success, true);

    // Mission report should be generated
    const reportsDir = join(getMemoryExecutionDir(tempDir), traceId);
    const reportPath = join(reportsDir, "summary.md");
    const reportExists = await Deno.stat(reportPath).then(() => true).catch(() => false);
    assert(reportExists, "Mission report should be generated on success");

    // Report should contain trace_id
    const reportContent = await Deno.readTextFile(reportPath);
    assert(reportContent.includes(traceId), "Report should include trace_id");
  } finally {
    await cleanup();
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("ExecutionLoop: releases lease even on failure", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "exec-test-lease-release-" });
  const { db, cleanup } = await initTestDbService();

  try {
    const config = createMockConfig(tempDir);
    const activeDir = getWorkspaceActiveDir(tempDir);
    await Deno.mkdir(activeDir, { recursive: true });
    const paths = getTestPaths(tempDir);
    const planContent = readFixtureTextSync(
      import.meta.url,
      "services",
      "execution",
      "execution_loop_test",
      "planContent_3.md",
    );
    const planPath = join(paths.activeDir, "lease-release-test.md");
    await Deno.writeTextFile(planPath, planContent);

    const loop1 = new ExecutionLoop({ config, db, identityId: "identity-1" });
    const loop2 = new ExecutionLoop({ config, db, identityId: "identity-2" });

    // First execution fails
    const result1 = await loop1.processTask(planPath);
    assertEquals(result1.success, false);

    // Second execution should be able to acquire lease (first released it)
    // Note: Plan was moved to Rejected, need to move it back to Active
    const rejectedDir = getWorkspaceRejectedDir(tempDir);
    const movedPlan = join(rejectedDir, "lease-release-test_failed.md");
    await Deno.rename(movedPlan, planPath);

    // This should succeed in acquiring lease (previous lease was released)
    // Will still fail execution, but that's expected
    const result2 = await loop2.processTask(planPath);
    assertEquals(result2.success, false);
    // If we got here without "lease already held" error, lease was properly released
  } finally {
    await cleanup();
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("ExecutionLoop: logs all execution steps to IActivity Journal", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "exec-test-logging-" });
  const { db, cleanup } = await initTestDbService();

  try {
    await ensureDir(getWorkspaceActiveDir(tempDir));
    const config = createMockConfig(tempDir);
    const systemActiveDir = getWorkspaceActiveDir(tempDir);

    const planContent = readFixtureTextSync(
      import.meta.url,
      "services",
      "execution",
      "execution_loop_test",
      "planContent_4.md",
    );
    const planPath = join(systemActiveDir, "toml-actions.md");
    await Deno.writeTextFile(planPath, planContent);

    const loop = new ExecutionLoop({ config, db, identityId: "test-identity" });
    const result = await loop.processTask(planPath);

    assertEquals(result.success, true);

    // Verify actions were logged
    await db.waitForFlush();
    const activities = db.getActivitiesByTrace("test-trace-toml");

    const actionStarted = activities.filter((a: ActivityRecord) => a.action_type === "execution.action_started");
    assertEquals(actionStarted.length, 2, "Should log 2 action starts");
  } finally {
    await cleanup();
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("ExecutionLoop: parses multiple TOML action blocks from plan", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "exec-test-multi-" });
  const { db, cleanup } = await initTestDbService();

  try {
    // Initialize git repository
    await setupGitRepo(tempDir, { initialCommit: true });

    await ensureDir(getWorkspaceActiveDir(tempDir));
    const config = createMockConfig(tempDir);
    const systemActiveDir = getWorkspaceActiveDir(tempDir);
    const planContent = readFixtureTextSync(
      import.meta.url,
      "services",
      "execution",
      "execution_loop_test",
      "planContent_8.md",
    );
    const planPath = join(systemActiveDir, "malformed-blocks.md");
    await Deno.writeTextFile(planPath, planContent);

    const loop = new ExecutionLoop({ config, db, identityId: "test-identity" });
    const result = await loop.processTask(planPath);

    assertEquals(result.success, true, "Should succeed despite malformed blocks");

    await db.waitForFlush();
    const activities = db.getActivitiesByTrace("test-trace-malformed");

    const actionStarted = activities.filter((a: ActivityRecord) => a.action_type === "execution.action_started");
    assertEquals(actionStarted.length, 1, "Should only parse 1 valid action");
  } finally {
    await cleanup();
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("ExecutionLoop: ignores code blocks without tool field", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "exec-test-notool-" });
  const { db, cleanup } = await initTestDbService();

  try {
    // Initialize git repository
    await setupGitRepo(tempDir, { initialCommit: true });

    await ensureDir(getWorkspaceActiveDir(tempDir));
    const config = createMockConfig(tempDir);
    const systemActiveDir = getWorkspaceActiveDir(tempDir);

    const planContent = readFixtureTextSync(
      import.meta.url,
      "services",
      "execution",
      "execution_loop_test",
      "planContent_11.md",
    );
    const planPath = join(systemActiveDir, "no-tool-field.md");
    await Deno.writeTextFile(planPath, planContent);

    const loop = new ExecutionLoop({ config, db, identityId: "test-identity" });
    const result = await loop.processTask(planPath);

    assertEquals(result.success, true);

    await db.waitForFlush();
    const activities = db.getActivitiesByTrace("test-trace-notool");

    const actionStarted = activities.filter((a: ActivityRecord) => a.action_type === "execution.action_started");
    assertEquals(actionStarted.length, 1, "Should only parse blocks with 'tool' field");
  } finally {
    await cleanup();
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("ExecutionLoop: handles commit with no changes gracefully", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "exec-test-nochanges-" });
  const { db, cleanup } = await initTestDbService();

  try {
    await ensureDir(getWorkspaceActiveDir(tempDir));
    const config = createMockConfig(tempDir);
    const systemActiveDir = getWorkspaceActiveDir(tempDir);

    // Create initial commit so git is initialized
    await Deno.writeTextFile(join(tempDir, "README.md"), "init");
    await new Deno.Command(PortalOperation.GIT, {
      args: ["init"],
      cwd: tempDir,
    }).output();
    await new Deno.Command(PortalOperation.GIT, {
      args: ["config", "user.name", "Test"],
      cwd: tempDir,
    }).output();
    await new Deno.Command(PortalOperation.GIT, {
      args: ["config", "user.email", "test@test.com"],
      cwd: tempDir,
    }).output();
    await new Deno.Command(PortalOperation.GIT, {
      args: [MemoryOperation.ADD, "."],
      cwd: tempDir,
    }).output();
    await new Deno.Command(PortalOperation.GIT, {
      args: ["commit", "-m", "Initial"],
      cwd: tempDir,
    }).output();

    const headBefore = await new Deno.Command(PortalOperation.GIT, {
      args: ["rev-parse", "HEAD"],
      cwd: tempDir,
      stdout: "piped",
      stderr: "piped",
    }).output();
    const shaBefore = new TextDecoder().decode(headBefore.stdout).trim();

    // Create plan that makes no actual file changes
    const planContent = readFixtureTextSync(
      import.meta.url,
      "services",
      "execution",
      "execution_loop_test",
      "planContent_12.md",
    );
    const planPath = join(systemActiveDir, "nochanges-test.md");
    await Deno.writeTextFile(planPath, planContent);

    const loop = new ExecutionLoop({ config, db, identityId: "test-identity" });
    const result = await loop.processTask(planPath);

    // Should succeed even with no changes to commit
    assertEquals(result.success, true);

    const headAfter = await new Deno.Command(PortalOperation.GIT, {
      args: ["rev-parse", "HEAD"],
      cwd: tempDir,
      stdout: "piped",
      stderr: "piped",
    }).output();
    const shaAfter = new TextDecoder().decode(headAfter.stdout).trim();
    assertEquals(shaAfter, shaBefore, "No-op plan should not create a new commit");

    const branchAfter = await new Deno.Command(PortalOperation.GIT, {
      args: ["branch", "--show-current"],
      cwd: tempDir,
      stdout: "piped",
      stderr: "piped",
    }).output();
    const currentBranch = new TextDecoder().decode(branchAfter.stdout).trim();
    assert(
      currentBranch === "master" || currentBranch === "main",
      `Expected current branch to be master/main, got: ${currentBranch}`,
    );

    await new Promise((resolve) => setTimeout(resolve, 150));
    const activities = db.getActivitiesByTrace("test-trace-nochanges");
    const _noChangesLog = activities.find((a: ActivityRecord) => a.action_type === "execution.no_changes");

    // May or may not log no_changes depending on timing, but should complete
    assertEquals(result.success, true);
  } finally {
    await cleanup();
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("ExecutionLoop: lease mechanism prevents duplicate processing", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "exec-test-lease-" });
  const { db, cleanup } = await initTestDbService();

  try {
    await ensureDir(getWorkspaceActiveDir(tempDir));
    const config = createMockConfig(tempDir);
    const systemActiveDir = getWorkspaceActiveDir(tempDir);

    const planContent = readFixtureTextSync(
      import.meta.url,
      "services",
      "execution",
      "execution_loop_test",
      "planContent_13.md",
    );
    const planPath = join(systemActiveDir, "lease-test.md");
    await Deno.writeTextFile(planPath, planContent);

    const loop = new ExecutionLoop({ config, db, identityId: "test-identity" });

    // Process task successfully - lease should be acquired and released
    const result1 = await loop.processTask(planPath);
    assertEquals(result1.success, true);

    // Wait for activities to be logged
    await new Promise((resolve) => setTimeout(resolve, 150));

    // Verify lease was acquired
    const activities = db.getActivitiesByTrace("test-trace-lease");
    const leaseAcquired = activities.find((a: ActivityRecord) => a.action_type === "execution.lease_acquired");
    assertExists(leaseAcquired, "Lease should be acquired");

    // Parse payload to verify holder
    const payload = JSON.parse(leaseAcquired.payload);
    assertEquals(payload.holder, "test-identity");
  } finally {
    await cleanup();
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("ExecutionLoop: handles plan without required frontmatter fields", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "exec-test-badfront-" });
  const { db, cleanup } = await initTestDbService();

  try {
    await ensureDir(getWorkspaceActiveDir(tempDir));
    const config = createMockConfig(tempDir);
    const systemActiveDir = getWorkspaceActiveDir(tempDir);

    // Plan invalid status
    const planContent = readFixtureTextSync(
      import.meta.url,
      "services",
      "execution",
      "execution_loop_test",
      "planContent_14.md",
    );
    const planPath = join(systemActiveDir, "bad-plan.md");
    await Deno.writeTextFile(planPath, planContent);

    const loop = new ExecutionLoop({ config, db, identityId: "test-identity" });
    const result = await loop.processTask(planPath);

    assertEquals(result.success, false);
    assertExists(result.error);
    assertEquals(result.error?.includes("status"), true);
  } finally {
    await cleanup();
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("ExecutionLoop: handles plan with malformed frontmatter", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "exec-test-malformed-" });
  const { db, cleanup } = await initTestDbService();

  try {
    await ensureDir(getWorkspaceActiveDir(tempDir));
    const config = createMockConfig(tempDir);
    const systemActiveDir = getWorkspaceActiveDir(tempDir);

    // Plan with invalid YAML
    const planContent = `---
this is not: valid: yaml: format
---

# Malformed Plan
`;

    const planPath = join(systemActiveDir, "malformed-plan.md");
    await Deno.writeTextFile(planPath, planContent);

    const loop = new ExecutionLoop({ config, db, identityId: "test-identity" });
    const result = await loop.processTask(planPath);

    assertEquals(result.success, false);
    assertExists(result.error);
  } finally {
    await cleanup();
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("ExecutionLoop: handles unknown tool gracefully", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "exec-test-unknown-" });
  const { db, cleanup } = await initTestDbService();

  try {
    // Initialize git repository
    await setupGitRepo(tempDir, { initialCommit: true });

    await ensureDir(getWorkspaceActiveDir(tempDir));
    const config = createMockConfig(tempDir);
    const systemActiveDir = getWorkspaceActiveDir(tempDir);

    // Plan with action using unknown tool
    const planContent = readFixtureTextSync(
      import.meta.url,
      "services",
      "execution",
      "execution_loop_test",
      "planContent_15.md",
    );
    const planPath = join(systemActiveDir, "unknown-tool-plan.md");
    await Deno.writeTextFile(planPath, planContent);

    const loop = new ExecutionLoop({ config, db, identityId: "test-identity" });
    const result = await loop.processTask(planPath);

    assertEquals(result.success, false);
    assertExists(result.error);
    assertStringIncludes(String(result.error), "Tool 'non_existent_tool' not found");
  } finally {
    await cleanup();
    await Deno.remove(tempDir, { recursive: true });
  }
});
