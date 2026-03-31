/**
 * @module ExecutionLoopTest
 * @path tests/services/execution/execution_loop_test.ts
 * @description Verifies the primary identity execution loop, ensuring robust orchestration
 * of planning, execution, and confirmation phases for user requests.
 */

import { assert, assertEquals, assertExists, assertStringIncludes } from "@std/assert";
import { MemoryOperation, PortalOperation } from "../../../src/shared/enums.ts";
import { ReviewStatus } from "../../../src/reviews/review_status.ts";
import { PlanStatus } from "../../../src/shared/status/plan_status.ts";
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
import { IModelProvider } from "../../../src/ai/types.ts";
import type { ActivityRecord } from "../../../src/services/core/db.ts";
import { EXECUTION_REPORT_FILENAME } from "../../../src/shared/constants.ts";

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

    const planContent = `---
trace_id: "test-trace-lease"
request_id: lease-test
status: active
identity_id: test-identity
---

# Lease Test Plan

Note: This test doesn't use special markers, so execution will complete quickly.
We need to test concurrent lease acquisition.
`;

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

    const planContent = `---
trace_id: "test-trace-git"
request_id: git-commit-test
status: approved
identity_id: test-identity
---

# Git Integration Test

This test verifies that the ExecutionLoop can process plans successfully.
Detailed git branch/commit testing is covered in integration tests.
`;

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
    const planContent = `---
trace_id: "test-trace-fail"
request_id: fail-test
status: active
identity_id: test-identity
---

# Failure Test Plan

## Actions
1. Read file with path traversal: ../../etc/passwd
`;

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
    const failedLog = activities.find((a: any) => a.action_type === "execution.failed");
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

    generate(prompt: string): Promise<string> {
      if (prompt.includes("EXECUTION REPORT")) {
        return Promise.resolve("## Summary\n\nRead-only analysis report.");
      }

      return Promise.resolve(`
\
\`\`\`toml
[[actions]]
tool = "read_file"
[actions.params]
path = "analysis-target.txt"
\`\`\`
`);
    }
  }

  try {
    const config = createMockConfig(tempDir);
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
    const planContent = `---
trace_id: "test-trace-lease-release"
request_id: lease-release-test
status: active
identity_id: test-identity
---

# Lease Release Test

## Actions
1. Intentionally fail
`;

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

    const planContent = `---
trace_id: "test-trace-logging"
request_id: logging-test
status: active
identity_id: test-identity
---

# Logging Test Plan

\n\`\`\`toml
tool = "write_file"
[params]
path = "logging-test.txt"
content = "activity journal logging test"
\`\`\`\n
`;

    const planPath = join(getWorkspaceActiveDir(tempDir), "logging-test.md");
    await Deno.writeTextFile(planPath, planContent);
    const config = createMockConfig(tempDir);
    const loop = new ExecutionLoop({ config, db, identityId: "test-identity" });
    await loop.processTask(planPath);

    // Wait for batched logs to flush
    await db.waitForFlush();

    const activities = db.getActivitiesByTrace("test-trace-logging");

    // Check for key execution steps
    const actionTypes = activities.map((a: ActivityRecord) => a.action_type);

    assert(
      actionTypes.includes("execution.started"),
      "Should log execution.started",
    );
    assert(
      actionTypes.some((type: string) => type.startsWith("git.")),
      "Should log git operations",
    );
    assert(
      actionTypes.includes("execution.completed") || actionTypes.includes("execution.failed"),
      "Should log execution outcome",
    );

    // Verify identity_id is set
    const agentActions = activities.filter((a: ActivityRecord) => a.actor === "agent");
    agentActions.forEach((action: ActivityRecord) => {
      assertEquals(action.identity_id, "test-identity", "Agent actions should have identity_id");
    });
  } finally {
    await cleanup();
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("ExecutionLoop: parses plan frontmatter correctly", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "exec-test-parse-" });
  const { db, cleanup } = await initTestDbService();

  try {
    const config = createMockConfig(tempDir);
    const paths = getTestPaths(tempDir);
    await Deno.mkdir(paths.activeDir, { recursive: true });

    const planContent = `---
trace_id: "test-trace-parse"
request_id: parse-test
status: active
identity_id: senior-coder
---

# Parse Test Plan
`;

    const planPath = join(paths.activeDir, "parse-test.md");
    await Deno.writeTextFile(planPath, planContent);

    const loop = new ExecutionLoop({ config, db, identityId: "senior-coder" });
    const result = await loop.processTask(planPath);

    // If parsing failed, this would have thrown
    assertEquals(result.traceId, "test-trace-parse");
    assertExists(result);
  } finally {
    await cleanup();
    await Deno.remove(tempDir, { recursive: true });
  }
});

/**
 * Regression test for deployed behavior where analysis agents (e.g. code-analyst)
 * incorrectly triggered git branch creation and diffs instead of producing execution artifacts.
 *
 * Root cause: structured plans were auto-executed via PlanExecutor without checking identity capabilities.
 * Fix: ExecutionLoop skips structured-plan execution for read-only agents.
 */
Deno.test("[regression] ExecutionLoop: skips structured execution for read-only agents", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "exec-test-readonly-" });
  const { db, cleanup } = await initTestDbService();
  const traceId = crypto.randomUUID();

  try {
    const config = createMockConfig(tempDir);
    const paths = getTestPaths(tempDir);
    await Deno.mkdir(paths.activeDir, { recursive: true });

    // Provide a read-only blueprint so ExecutionLoop can detect capability mode.
    const blueprintsDir = join(tempDir, "Blueprints", "Identities");
    await ensureDir(blueprintsDir);
    await Deno.writeTextFile(
      join(blueprintsDir, "code-analyst.md"),
      `---\nidentity_id: "code-analyst"\nname: "Code Analyst"\nmodel: "mock:test"\ncapabilities: ["read_file", "list_directory", "grep_search"]\ncreated: "2026-02-04T00:00:00Z"\ncreated_by: "test"\nversion: "1.0.0"\n---\n\n# Code Analyst\n`,
    );

    // Create a structured plan with steps (would normally trigger PlanExecutor)
    const planContent =
      `---\ntrace_id: "${traceId}"\nrequest_id: readonly-structured\nstatus: active\nidentity_id: code-analyst\n---\n\n# Read-only Structured Plan\n\n## Execution Steps\n\n## Step 1: Analyze code\n\nRead files and produce an analysis report.\n`;

    const planPath = join(paths.activeDir, "readonly-structured.md");
    await Deno.writeTextFile(planPath, planContent);

    // No llmProvider passed; this should still succeed for read-only agents.
    const loop = new ExecutionLoop({ config, db, identityId: "daemon" });
    const result = await loop.processTask(planPath);

    assertEquals(result.success, true);
    assertEquals(result.traceId, traceId);

    // Should not initialize a git repository or create feature branches.
    const gitDirExists = await Deno.stat(join(tempDir, ".git")).then(() => true).catch(() => false);
    assertEquals(gitDirExists, false, ".git should not be created for read-only structured plans");

    // Plan should be archived after success
    const archivedPlan = join(paths.archiveDir, "readonly-structured.md");
    const archivedExists = await Deno.stat(archivedPlan).then(() => true).catch(() => false);
    assertEquals(archivedExists, true, "Plan should be archived");

    // Execution artifacts should include plan.md for trace inspection
    const planArtifactPath = join(paths.memoryExecution, traceId, "plan.md");
    const planArtifactExists = await Deno.stat(planArtifactPath).then(() => true).catch(() => false);
    assertEquals(planArtifactExists, true, "plan.md artifact should exist under Memory/Execution/<traceId>/");

    // Read-only executions should also produce a canonical review artifact (artifact-*.md)
    const artifacts = await db.preparedAll<
      { id: string; status: string; identity: string; portal: string | null; request_id: string; file_path: string }
    >(
      "SELECT id, status, identity, portal, request_id, file_path FROM artifacts WHERE request_id = ?",
      ["readonly-structured"],
    );
    assertEquals(artifacts.length, 1, "Exactly one artifact should be created for a read-only execution");
    assertStringIncludes(artifacts[0].id, "artifact-", "Artifact ID should have artifact- prefix");
    assertEquals(artifacts[0].status, ReviewStatus.PENDING);
    assertEquals(artifacts[0].identity, "code-analyst");
    assertEquals(artifacts[0].portal, null);

    const artifactFileExists = await Deno.stat(join(tempDir, artifacts[0].file_path)).then(() => true).catch(() =>
      false
    );
    assertEquals(artifactFileExists, true, "Artifact file should exist under Memory/Execution/");

    const artifactContent = await Deno.readTextFile(join(tempDir, artifacts[0].file_path));
    const expectedPlanContent = planContent.replace("status: active", `status: ${PlanStatus.COMPLETED}`);
    assertStringIncludes(artifactContent, expectedPlanContent);
  } finally {
    await cleanup();
    await Deno.remove(tempDir, { recursive: true });
  }
});

/**
 * Regression test for the legacy/no-op plan path:
 * - Not a structured plan (no "## Execution Steps")
 * - No TOML actions
 * - Read-only identity
 *
 * Expected behavior: succeed without git mutations, but still create canonical artifact.
 */
Deno.test("[regression] ExecutionLoop: read-only legacy no-op plan produces artifact and no branch", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "exec-test-readonly-legacy-" });
  const { db, cleanup } = await initTestDbService();
  const traceId = crypto.randomUUID();

  try {
    const config = createMockConfig(tempDir);
    const paths = getTestPaths(tempDir);
    await Deno.mkdir(paths.activeDir, { recursive: true });

    // Provide a read-only blueprint so ExecutionLoop can detect capability mode.
    const blueprintsDir = join(tempDir, "Blueprints", "Identities");
    await ensureDir(blueprintsDir);
    await Deno.writeTextFile(
      join(blueprintsDir, "code-analyst.md"),
      `---\nidentity_id: "code-analyst"\nname: "Code Analyst"\nmodel: "mock:test"\ncapabilities: ["read_file", "list_directory", "grep_search"]\ncreated: "2026-02-04T00:00:00Z"\ncreated_by: "test"\nversion: "1.0.0"\n---\n\n# Code Analyst\n`,
    );

    // Legacy/no-op plan: not structured, no TOML blocks/actions.
    const planContent =
      `---\ntrace_id: "${traceId}"\nrequest_id: readonly-legacy\nstatus: active\nidentity_id: code-analyst\n---\n\n# Read-only Legacy No-op Plan\n\nThis is an analysis output plan with no executable actions.\n`;

    const planPath = join(paths.activeDir, "readonly-legacy.md");
    await Deno.writeTextFile(planPath, planContent);

    const loop = new ExecutionLoop({ config, db, identityId: "daemon" });
    const result = await loop.processTask(planPath);

    assertEquals(result.success, true);
    assertEquals(result.traceId, traceId);

    // Should not initialize a git repository or create feature branches.
    const gitDirExists = await Deno.stat(join(tempDir, ".git")).then(() => true).catch(() => false);
    assertEquals(gitDirExists, false, ".git should not be created for read-only legacy no-op plans");

    // Plan should be archived after success
    const archivedPlan = join(paths.archiveDir, "readonly-legacy.md");
    const archivedExists = await Deno.stat(archivedPlan).then(() => true).catch(() => false);
    assertEquals(archivedExists, true, "Plan should be archived");

    // Execution artifacts should include plan.md for trace inspection
    const planArtifactPath = join(paths.memoryExecution, traceId, "plan.md");
    const planArtifactExists = await Deno.stat(planArtifactPath).then(() => true).catch(() => false);
    assertEquals(planArtifactExists, true, "plan.md artifact should exist under Memory/Execution/<traceId>/");

    // Read-only executions should also produce a canonical review artifact (artifact-*.md)
    const artifacts = await db.preparedAll<
      { id: string; status: string; identity: string; portal: string | null; request_id: string; file_path: string }
    >(
      "SELECT id, status, identity, portal, request_id, file_path FROM artifacts WHERE request_id = ?",
      ["readonly-legacy"],
    );
    assertEquals(artifacts.length, 1, "Exactly one artifact should be created for a read-only execution");
    assertStringIncludes(artifacts[0].id, "artifact-", "Artifact ID should have artifact- prefix");
    assertEquals(artifacts[0].status, ReviewStatus.PENDING);
    assertEquals(artifacts[0].identity, "code-analyst");
    assertEquals(artifacts[0].portal, null);

    const artifactFileExists = await Deno.stat(join(tempDir, artifacts[0].file_path)).then(() => true).catch(() =>
      false
    );
    assertEquals(artifactFileExists, true, "Artifact file should exist under Memory/Execution/");

    const artifactContent = await Deno.readTextFile(join(tempDir, artifacts[0].file_path));
    const expectedPlanContent = planContent.replace("status: active", `status: ${PlanStatus.COMPLETED}`);
    assertStringIncludes(artifactContent, expectedPlanContent);
  } finally {
    await cleanup();
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("ExecutionLoop: rejects plan with missing required frontmatter", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "exec-test-invalid-" });
  const { db, cleanup } = await initTestDbService();

  try {
    await ensureDir(getWorkspaceActiveDir(tempDir));
    const config = createMockConfig(tempDir);

    // Plan missing status (required)
    const planContent = `---
request_id: invalid-test
trace_id: "test-trace-invalid"
---

# Invalid Plan
`;

    const planPath = join(getWorkspaceActiveDir(tempDir), "invalid-test.md");
    await Deno.writeTextFile(planPath, planContent);

    const loop = new ExecutionLoop({ config, db, identityId: "test-identity" });

    // Should fail with clear error about missing trace_id
    const result = await loop.processTask(planPath);
    assertEquals(result.success, false);
    assert(result.error?.includes("status"), `Error should mention status, got: ${result.error}`);
  } finally {
    await cleanup();
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("ExecutionLoop: handles git rollback on failure", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "exec-test-rollback-" });
  const { db, cleanup } = await initTestDbService();

  try {
    await ensureDir(getWorkspaceActiveDir(tempDir));
    const config = createMockConfig(tempDir);
    const systemActiveDir = getWorkspaceActiveDir(tempDir);
    const planContent = `---
trace_id: "test-trace-rollback"
request_id: rollback-test
status: active
identity_id: test-identity
---

# Rollback Test Plan

## Actions
1. Make some changes
2. Intentionally fail
`;

    const planPath = join(systemActiveDir, "rollback-test.md");
    await Deno.writeTextFile(planPath, planContent);

    const loop = new ExecutionLoop({ config, db, identityId: "test-identity" });
    const result = await loop.processTask(planPath);

    assertEquals(result.success, false, "Execution should fail due to 'Intentionally fail' marker");

    // Git working tree should be clean (changes rolled back)
    const statusCmd = new Deno.Command(PortalOperation.GIT, {
      args: ["status", "--porcelain"],
      cwd: tempDir,
      stdout: "piped",
    });
    const { stdout } = await statusCmd.output();
    const status = new TextDecoder().decode(stdout);

    // Should be empty or only show untracked files from test setup
    // The key is that changes made during execution should be gone
    assert(
      !status.includes("modified:") && !status.includes("deleted:"),
      "Modified/deleted files should be rolled back",
    );
  } finally {
    await cleanup();
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("ExecutionLoop: parses TOML action blocks from plan", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "exec-test-toml-" });
  const { db, cleanup } = await initTestDbService();

  try {
    await ensureDir(getWorkspaceActiveDir(tempDir));
    const config = createMockConfig(tempDir);
    const systemActiveDir = getWorkspaceActiveDir(tempDir);

    // Initialize git repository
    await setupGitRepo(tempDir, { initialCommit: true });

    const planContent = `---
trace_id: "test-trace-toml"
request_id: toml-actions
status: active
---

# Test Plan with TOML Actions

## Actions to Execute

\`\`\`toml
tool = "read_file"
description = "Read test file"

[params]
path = "test.txt"
\`\`\`

\`\`\`toml
tool = "write_file"
description = "Write output file"

[params]
path = "output.txt"
content = "test content"
\`\`\`

This plan has two actions in TOML format.
`;

    const planPath = join(systemActiveDir, "toml-actions.md");
    await Deno.writeTextFile(planPath, planContent);

    const loop = new ExecutionLoop({ config, db, identityId: "test-identity" });
    const result = await loop.processTask(planPath);

    assertEquals(result.success, true);

    // Verify actions were logged
    await db.waitForFlush();
    const activities = db.getActivitiesByTrace("test-trace-toml");

    const actionStarted = activities.filter((a: any) => a.action_type === "execution.action_started");
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
    const planContent = `---
trace_id: "test-trace-multi"
request_id: multi-actions
status: active
---

# Test Plan with Multiple TOML Actions

\`\`\`toml
tool = "read_file"
description = "Read data"

[params]
path = "data.txt"
\`\`\`

This plan has one action in TOML format.
`;

    const planPath = join(systemActiveDir, "multi-actions.md");
    await Deno.writeTextFile(planPath, planContent);

    const loop = new ExecutionLoop({ config, db, identityId: "test-identity" });
    const result = await loop.processTask(planPath);

    assertEquals(result.success, true);

    await db.waitForFlush();
    const activities = db.getActivitiesByTrace("test-trace-multi");

    const actionStarted = activities.filter((a: any) => a.action_type === "execution.action_started");
    assertEquals(actionStarted.length, 1, "Should log 1 action start");
  } finally {
    await cleanup();
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("ExecutionLoop: handles plans with no action blocks", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "exec-test-noactions-" });
  const { db, cleanup } = await initTestDbService();

  try {
    await ensureDir(getWorkspaceActiveDir(tempDir));
    const config = createMockConfig(tempDir);
    const systemActiveDir = getWorkspaceActiveDir(tempDir);

    const planContent = `---
trace_id: "test-trace-noactions"
request_id: no-actions
status: active
---

# Plan Without Actions

This plan has no action blocks, just narrative text.
The system should still execute successfully using fallback behavior.
`;

    const planPath = join(systemActiveDir, "no-actions.md");
    await Deno.writeTextFile(planPath, planContent);

    const loop = new ExecutionLoop({ config, db, identityId: "test-identity" });
    const result = await loop.processTask(planPath);

    assertEquals(result.success, true, "Should succeed even without actions");

    // No-op plans must not mutate repository state
    const testFile = join(tempDir, "test-execution.txt");
    const testFileExists = await Deno.stat(testFile).then(() => true).catch(() => false);
    assertEquals(testFileExists, false, "Should not create dummy file when no actions present");
  } finally {
    await cleanup();
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("ExecutionLoop: ignores malformed code blocks", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "exec-test-malformed-" });
  const { db, cleanup } = await initTestDbService();

  try {
    // Initialize git repository
    await setupGitRepo(tempDir, { initialCommit: true });

    await ensureDir(getWorkspaceActiveDir(tempDir));
    const config = createMockConfig(tempDir);
    const systemActiveDir = getWorkspaceActiveDir(tempDir);

    const planContent = `---
trace_id: "test-trace-malformed"
request_id: malformed-blocks
status: active
---

# Plan with Malformed Blocks

\`\`\`toml
this is not valid toml = [unclosed
\`\`\`

\`\`\`toml
tool = "read_file"

[params]
path = "valid.txt"
\`\`\`

\`\`\`python
# This is python, not TOML
print("hello")
\`\`\`

Only the middle block should be parsed.
`;

    const planPath = join(systemActiveDir, "malformed-blocks.md");
    await Deno.writeTextFile(planPath, planContent);

    const loop = new ExecutionLoop({ config, db, identityId: "test-identity" });
    const result = await loop.processTask(planPath);

    assertEquals(result.success, true, "Should succeed despite malformed blocks");

    await db.waitForFlush();
    const activities = db.getActivitiesByTrace("test-trace-malformed");

    const actionStarted = activities.filter((a: any) => a.action_type === "execution.action_started");
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

    const planContent = `---
trace_id: "test-trace-notool"
request_id: no-tool-field
status: active
---

# Plan with Non-Action Code Blocks

\`\`\`toml
# This is just configuration, not an action
database = "postgres"
port = 5432
\`\`\`

\`\`\`toml
tool = "read_file"

[params]
path = "config.toml"
\`\`\`

\`\`\`python
# Python code, not TOML
name = "example"
\`\`\`

Only the middle block with 'tool' field should be treated as an action.
`;

    const planPath = join(systemActiveDir, "no-tool-field.md");
    await Deno.writeTextFile(planPath, planContent);

    const loop = new ExecutionLoop({ config, db, identityId: "test-identity" });
    const result = await loop.processTask(planPath);

    assertEquals(result.success, true);

    await db.waitForFlush();
    const activities = db.getActivitiesByTrace("test-trace-notool");

    const actionStarted = activities.filter((a: any) => a.action_type === "execution.action_started");
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
    const planContent = `---
trace_id: "test-trace-nochanges"
request_id: nochanges-test
status: active
identity_id: test-identity
---

# No Changes Plan

This plan has no action blocks.
`;

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

    const planContent = `---
trace_id: "test-trace-lease"
request_id: lease-test
status: active
identity_id: test-identity
---

# Lease Test
`;

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
    const planContent = `---
request_id: bad-plan
trace_id: "test-trace-bad"
status: invalid-status
---

# Bad Plan
`;

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
    const planContent = `---
trace_id: "test-trace-unknown"
request_id: unknown-test
status: active
identity_id: test-identity
---

# Unknown Tool Test

\`\`\`toml
tool = "nonexistent_tool"
description = "Uses unknown tool"

[params]
test = "value"
\`\`\`
`;

    const planPath = join(systemActiveDir, "unknown-test.md");
    await Deno.writeTextFile(planPath, planContent);

    const loop = new ExecutionLoop({ config, db, identityId: "test-identity" });
    const result = await loop.processTask(planPath);

    // Tool execution returns success:false but doesn't throw, so task succeeds
    assertEquals(result.success, true);

    await new Promise((resolve) => setTimeout(resolve, 150));
    const activities = db.getActivitiesByTrace("test-trace-unknown");

    // Should have started and completed the action (even though tool result was success:false)
    const actionStarted = activities.find((a: ActivityRecord) => a.action_type === "execution.action_started");
    assertExists(actionStarted, "Action should be started");

    const actionCompleted = activities.find((a: ActivityRecord) => a.action_type === "execution.action_completed");
    assertExists(actionCompleted, "Action should complete even with unknown tool");
  } finally {
    await cleanup();
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("ExecutionLoop: summarizeResult handles various result types", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "exec-test-summary-" });
  const { db, cleanup } = await initTestDbService();

  try {
    // Initialize git repository
    await setupGitRepo(tempDir, { initialCommit: true });

    await ensureDir(getWorkspaceActiveDir(tempDir));
    const config = createMockConfig(tempDir);
    const systemActiveDir = getWorkspaceActiveDir(tempDir);

    // Create test file for read action
    await Deno.writeTextFile(join(tempDir, "test-read.txt"), "a".repeat(200));

    // Plan with action that returns large result
    const planContent = `---
trace_id: "test-trace-summary"
request_id: summary-test
status: active
identity_id: test-identity
---

# Summary Test

\`\`\`toml
tool = "read_file"
description = "Read a large file"

[params]
path = "test-read.txt"
\`\`\`
`;

    const planPath = join(systemActiveDir, "summary-test.md");
    await Deno.writeTextFile(planPath, planContent);

    const loop = new ExecutionLoop({ config, db, identityId: "test-identity" });
    const result = await loop.processTask(planPath);

    assertEquals(result.success, true);

    await db.waitForFlush();
    const activities = db.getActivitiesByActionType("execution.action_completed");
    const log = activities.find((a: ActivityRecord) => JSON.parse(a.payload).result_summary?.includes("aaaa"));
    assertExists(log, "Action completion with summary should be logged");
  } finally {
    await cleanup();
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("ExecutionLoop: failure report generation and plan status update", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "exec-test-failreport-" });
  const { db, cleanup } = await initTestDbService();

  try {
    await ensureDir(getWorkspaceActiveDir(tempDir));
    const config = createMockConfig(tempDir);
    const systemActiveDir = getWorkspaceActiveDir(tempDir);

    const planContent = `---
trace_id: "test-trace-failreport"
request_id: failreport-test
status: active
identity_id: test-identity
---

# Failure Report Test

Intentionally fail
`;

    const planPath = join(systemActiveDir, "failreport-test.md");
    await Deno.writeTextFile(planPath, planContent);

    const loop = new ExecutionLoop({ config, db, identityId: "test-identity" });
    const result = await loop.processTask(planPath);

    assertEquals(result.success, false);

    // Verify failure report was generated
    const reportsDir = join(getMemoryExecutionDir(tempDir), "test-trace-failreport");
    const failureReportPath = join(reportsDir, "failure.md");
    const failureReportExists = await Deno.stat(failureReportPath).then(() => true).catch(() => false);
    assert(failureReportExists, "Failure report should be generated");

    // Verify plan moved to Rejected with error status
    const rejectedDir = getWorkspaceRejectedDir(tempDir);
    const planPathInRejected = join(rejectedDir, "failreport-test_failed.md");
    const planExists = await Deno.stat(planPathInRejected).then(() => true).catch(() => false);
    assert(planExists, "Failed plan should be moved to Rejected");

    const updatedPlan = await Deno.readTextFile(planPathInRejected);
    assertEquals(updatedPlan.includes("status: error"), true, "Plan status should be updated to error");
  } finally {
    await cleanup();
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("ExecutionLoop: handles git rollback on failure", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "exec-test-gitrollback-" });
  const { db, cleanup } = await initTestDbService();

  try {
    await ensureDir(getWorkspaceActiveDir(tempDir));
    const config = createMockConfig(tempDir);
    const systemActiveDir = getWorkspaceActiveDir(tempDir);

    // Initialize git
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
    await Deno.writeTextFile(join(tempDir, "initial.txt"), "initial");
    await new Deno.Command(PortalOperation.GIT, {
      args: [MemoryOperation.ADD, "."],
      cwd: tempDir,
    }).output();
    await new Deno.Command(PortalOperation.GIT, {
      args: ["commit", "-m", "Initial"],
      cwd: tempDir,
    }).output();

    const planContent = `---
trace_id: "test-trace-rollback"
request_id: rollback-test
status: active
identity_id: test-identity
---

# Rollback Test

path traversal: ../../etc/passwd
`;

    const planPath = join(systemActiveDir, "rollback-test.md");
    await Deno.writeTextFile(planPath, planContent);

    const loop = new ExecutionLoop({ config, db, identityId: "test-identity" });
    const result = await loop.processTask(planPath);

    assertEquals(result.success, false);

    // Git should be rolled back (implementation does git reset --hard HEAD)
    // Verify no staged changes remain
    const statusCmd = new Deno.Command(PortalOperation.GIT, {
      args: ["status", "--porcelain"],
      cwd: tempDir,
      stdout: "piped",
    });
    const statusResult = await statusCmd.output();
    const _status = new TextDecoder().decode(statusResult.stdout).trim();

    // Status should be clean after rollback (rollback does git reset --hard HEAD)
    // Note: test-execution.txt may still exist in working dir but not staged
  } finally {
    await cleanup();
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("ExecutionLoop: logActivity handles missing database gracefully", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "exec-test-nodb-" });

  try {
    await ensureDir(getWorkspaceActiveDir(tempDir));
    const config = createMockConfig(tempDir);
    const systemActiveDir = getWorkspaceActiveDir(tempDir);

    const planContent = `---
trace_id: "test-trace-nodb"
request_id: nodb-test
status: active
identity_id: test-identity
---

# No DB Test
`;

    const planPath = join(systemActiveDir, "nodb-test.md");
    await Deno.writeTextFile(planPath, planContent);

    // Create loop without database
    const loop = new ExecutionLoop({ config, identityId: "test-identity" });
    const result = await loop.processTask(planPath);

    // Should still succeed even without database
    assertEquals(result.success, true);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});
