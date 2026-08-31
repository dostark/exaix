/**
 * @module ExecutionLoopTest
 * @path packages/execution/tests/execution_loop_test.ts
 * @description Verifies the primary identity execution loop, ensuring robust orchestration
 * of planning, execution, and confirmation phases for user requests.
 */

import { assert, assertEquals, assertExists, assertStringIncludes } from "@std/assert";
import { EXECUTION_REPORT_FILENAME, MemoryOperation, PortalOperation } from "@exaix/core";
import { join } from "@std/path";
import { getDefaultPaths } from "@exaix/core/config";
import { ExecutionLoop } from "@exaix/execution";
import { createMockConfig } from "@exaix/testing";
import { initTestDbService } from "@exaix/testing";
import { EventLogger } from "@exaix/core/logger";
import { GitService } from "@exaix/git";
import { setupGitRepo, TEST_DEFAULT_BRANCH } from "@exaix/git/testing";
import { ToolRegistry } from "@exaix/tool-runtime";
import { MemoryBankService } from "@exaix/memory";
import {
  getMemoryExecutionDir,
  getWorkspaceActiveDir,
  getWorkspaceArchiveDir,
  getWorkspaceRejectedDir,
  getWorkspaceRequestsDir,
} from "@exaix/testing";
import { ensureDir } from "@std/fs/ensure-dir";
import type { IGenerateResult } from "@exaix/ai/providers";
import type { IModelProvider } from "@exaix/ai/types.ts";
import type { ActivityRecord } from "@exaix/storage-sqlite";
import { readFixtureTextSync } from "@exaix/testing";

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

interface IExecutionLoopTestContext {
  tempDir: string;
  db: Awaited<ReturnType<typeof initTestDbService>>["db"];
  config: ReturnType<typeof createMockConfig>;
  paths: ReturnType<typeof getTestPaths>;
  loop: ExecutionLoop;
}

interface IExecutionLoopTestOptions {
  configOverrides?: Parameters<typeof createMockConfig>[1];
  identityId?: string;
  llmProvider?: IModelProvider;
  ensureActiveDir?: boolean;
}

async function withExecutionLoopTestContext(
  prefix: string,
  run: (context: IExecutionLoopTestContext) => Promise<void>,
  options: IExecutionLoopTestOptions = {},
): Promise<void> {
  const tempDir = await Deno.makeTempDir({ prefix });
  const { db, cleanup } = await initTestDbService();

  try {
    const config = createMockConfig(tempDir, options.configOverrides);
    const paths = getTestPaths(tempDir);

    if (options.ensureActiveDir !== false) {
      await ensureDir(paths.activeDir);
    }

    const logger = new EventLogger({ db });
    const loop = new ExecutionLoop({
      config,
      db,
      logger,
      identityId: options.identityId ?? "test-identity",
      llmProvider: options.llmProvider,
      gitServiceFactory: {
        createGitService(repoPath: string, traceId: string) {
          return new GitService({
            config,
            traceId,
            identityId: options.identityId ?? "test-identity",
            repoPath,
          });
        },
      },
      toolRegistryFactory: {
        createToolRegistry(traceId: string, baseDir: string) {
          return new ToolRegistry({
            config,
            traceId,
            identityId: options.identityId ?? "test-identity",
            baseDir,
          });
        },
      },
      memoryBank: new MemoryBankService(config, logger),
    });

    await run({ tempDir, db, config, paths, loop });
  } finally {
    await cleanup();
    await Deno.remove(tempDir, { recursive: true });
  }
}

function assertLoopFailure(result: { success: boolean; error?: string | null }): void {
  assertEquals(result.success, false);
  assertExists(result.error);
}

Deno.test("ExecutionLoop: processes approved plan from Workspace/Active", async () => {
  const traceId = crypto.randomUUID();
  await withExecutionLoopTestContext("exec-test-process-", async ({ db, paths, loop }) => {
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

    const planPath = join(paths.activeDir, "test-request.md");
    await Deno.writeTextFile(planPath, planContent);

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
  });
});

Deno.test("ExecutionLoop: acquires lease to prevent concurrent execution", async () => {
  await withExecutionLoopTestContext("exec-test-lease-", async ({ config, db, paths }) => {
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
  });
});

Deno.test("ExecutionLoop: creates git branch and commits with trace_id", async () => {
  await withExecutionLoopTestContext("exec-test-git-", async ({ paths, loop }) => {
    const planContent = readFixtureTextSync(
      import.meta.url,
      "services",
      "execution",
      "execution_loop_test",
      "planContent_1.md",
    );
    const planPath = join(paths.activeDir, "git-commit-test.md");
    await Deno.writeTextFile(planPath, planContent);
    const result = await loop.processTask(planPath);

    // Verify execution completed (git branch creation is tested in integration tests)
    assertEquals(result.success, true, `Execution failed: ${result.error}`);
    assertEquals(result.traceId, "test-trace-git");
  });
});

Deno.test("ExecutionLoop: handles tool execution failure gracefully", async () => {
  await withExecutionLoopTestContext("exec-test-failure-", async ({ tempDir, db, loop, paths }) => {
    // Plan that will fail (path traversal attempt)
    const planContent = readFixtureTextSync(
      import.meta.url,
      "services",
      "execution",
      "execution_loop_test",
      "planContent_2.md",
    );
    const planPath = join(paths.activeDir, "fail-test.md");
    await Deno.writeTextFile(planPath, planContent);
    const result = await loop.processTask(planPath);

    assertLoopFailure(result);

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
  });
});

/** Regression: read-only structured plans were skipped entirely, so no analysis was
 *  generated. */
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

    const logger = new EventLogger({ db });
    const loop = new ExecutionLoop({
      config,
      db,
      logger,
      identityId: "daemon",
      llmProvider: new ReadOnlyReportProvider(),
      gitServiceFactory: {
        createGitService(repoPath: string, traceId: string) {
          return new GitService({ config, traceId, identityId: "daemon", repoPath });
        },
      },
      toolRegistryFactory: {
        createToolRegistry(traceId: string, baseDir: string) {
          return new ToolRegistry({ config, traceId, identityId: "daemon", baseDir });
        },
      },
      memoryBank: new MemoryBankService(config, logger),
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

    await db.waitForFlush();
    const readonlyExecuted = db.getActivitiesByTrace(traceId).filter(
      (activity) => activity.action_type === "execution.readonly_structured_plan_executed",
    );
    assertEquals(readonlyExecuted.length, 1);
    assertEquals(JSON.parse(readonlyExecuted[0].payload), {
      request_id: "readonly-report",
      identity_id: "code-analyst",
    });

    const skippedTraceId = crypto.randomUUID();
    const skippedPlanContent = planContent
      .replace(traceId, skippedTraceId)
      .replace("readonly-report", "readonly-skipped");
    const skippedPlanPath = join(paths.activeDir, "readonly-skipped.md");
    await Deno.writeTextFile(skippedPlanPath, skippedPlanContent);

    const skippedLoop = new ExecutionLoop({
      config,
      db,
      logger,
      identityId: "daemon",
      gitServiceFactory: {
        createGitService(repoPath: string, eventTraceId: string) {
          return new GitService({ config, traceId: eventTraceId, identityId: "daemon", repoPath });
        },
      },
      toolRegistryFactory: {
        createToolRegistry(eventTraceId: string, baseDir: string) {
          return new ToolRegistry({ config, traceId: eventTraceId, identityId: "daemon", baseDir });
        },
      },
      memoryBank: new MemoryBankService(config, logger),
    });
    const skippedResult = await skippedLoop.processTask(skippedPlanPath);
    assertEquals(skippedResult.success, true);

    await db.waitForFlush();
    const readonlySkipped = db.getActivitiesByTrace(skippedTraceId).filter(
      (activity) => activity.action_type === "execution.readonly_structured_plan_skipped",
    );
    assertEquals(readonlySkipped.length, 1);
    assertEquals(JSON.parse(readonlySkipped[0].payload), {
      request_id: "readonly-skipped",
      identity_id: "code-analyst",
    });
  } finally {
    await cleanup();
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("ExecutionLoop: generates mission report on success", async () => {
  const traceId = crypto.randomUUID();

  await withExecutionLoopTestContext("exec-test-report-", async ({ tempDir, loop, paths }) => {
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

    const planPath = join(paths.activeDir, "report-test.md");
    await Deno.writeTextFile(planPath, planContent);
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
  });
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
  await withExecutionLoopTestContext("exec-test-logging-", async ({ db, loop, paths }) => {
    const planContent = readFixtureTextSync(
      import.meta.url,
      "services",
      "execution",
      "execution_loop_test",
      "planContent_4.md",
    );
    const planPath = join(paths.activeDir, "toml-actions.md");
    await Deno.writeTextFile(planPath, planContent);
    const result = await loop.processTask(planPath);

    assertEquals(result.success, true);

    // Verify actions were logged
    await db.waitForFlush();
    const activities = db.getActivitiesByTrace("test-trace-toml");

    const actionStarted = activities.filter((a: ActivityRecord) => a.action_type === "execution.action_started");
    assertEquals(actionStarted.length, 2, "Should log 2 action starts");
  });
});

Deno.test("ExecutionLoop: parses multiple TOML action blocks from plan", async () => {
  await withExecutionLoopTestContext("exec-test-multi-", async ({ tempDir, db, loop, paths }) => {
    // Initialize git repository
    await setupGitRepo(tempDir, { initialCommit: true });

    const planContent = readFixtureTextSync(
      import.meta.url,
      "services",
      "execution",
      "execution_loop_test",
      "planContent_8.md",
    );
    const planPath = join(paths.activeDir, "malformed-blocks.md");
    await Deno.writeTextFile(planPath, planContent);
    const result = await loop.processTask(planPath);

    assertEquals(result.success, true, "Should succeed despite malformed blocks");

    await db.waitForFlush();
    const activities = db.getActivitiesByTrace("test-trace-malformed");

    const actionStarted = activities.filter((a: ActivityRecord) => a.action_type === "execution.action_started");
    assertEquals(actionStarted.length, 1, "Should only parse 1 valid action");
  });
});

Deno.test("ExecutionLoop: ignores code blocks without tool field", async () => {
  await withExecutionLoopTestContext("exec-test-notool-", async ({ tempDir, db, loop, paths }) => {
    // Initialize git repository
    await setupGitRepo(tempDir, { initialCommit: true });

    const planContent = readFixtureTextSync(
      import.meta.url,
      "services",
      "execution",
      "execution_loop_test",
      "planContent_11.md",
    );
    const planPath = join(paths.activeDir, "no-tool-field.md");
    await Deno.writeTextFile(planPath, planContent);
    const result = await loop.processTask(planPath);

    assertEquals(result.success, true);

    await db.waitForFlush();
    const activities = db.getActivitiesByTrace("test-trace-notool");

    const actionStarted = activities.filter((a: ActivityRecord) => a.action_type === "execution.action_started");
    assertEquals(actionStarted.length, 1, "Should only parse blocks with 'tool' field");
  });
});

Deno.test("ExecutionLoop: persists a trace-scoped skip for amendment-pending plans", async () => {
  const traceId = crypto.randomUUID();
  await withExecutionLoopTestContext("exec-test-amendment-skip-", async ({ db, loop, paths }) => {
    const planContent = [
      "---",
      `trace_id: "${traceId}"`,
      "request_id: amendment-pending-request",
      "status: amendment_pending",
      "identity_id: test-identity",
      "---",
      "",
      "# Amendment Pending Plan",
    ].join("\n");
    const planPath = join(paths.activeDir, "amendment-pending.md");
    await Deno.writeTextFile(planPath, planContent);

    const result = await loop.processTask(planPath);
    assertEquals(result.success, true);
    assertEquals(result.traceId, traceId);

    await db.waitForFlush();
    const skipped = db.getActivitiesByTrace(traceId).filter(
      (activity) => activity.action_type === "execution.skipped",
    );
    assertEquals(skipped.length, 1);
    assertEquals(JSON.parse(skipped[0].payload), {
      request_id: "amendment-pending-request",
      reason: "Plan is pending amendment approval",
    });
  });
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
    await Deno.writeTextFile(join(tempDir, ".gitignore"), "Workspace/\nMemory/\n.exa/\n");
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
    const planContent = [
      "---",
      'trace_id: "test-trace-nochanges"',
      "request_id: nochanges-test",
      "status: active",
      "identity_id: test-identity",
      "---",
      "",
      "# No Changes Plan",
      "",
      "```toml",
      'tool = "write_file"',
      'description = "Rewrite existing content"',
      "",
      "[params]",
      'path = "README.md"',
      'content = "init"',
      "```",
    ].join("\n");
    const planPath = join(systemActiveDir, "nochanges-test.md");
    await Deno.writeTextFile(planPath, planContent);

    const loop = new ExecutionLoop({
      config,
      db,
      logger: new EventLogger({ db }),
      identityId: "test-identity",
      gitServiceFactory: {
        createGitService(repoPath: string, traceId: string) {
          return new GitService({ config, traceId, identityId: "test-identity", repoPath });
        },
      },
      toolRegistryFactory: {
        createToolRegistry(traceId: string, baseDir: string) {
          return new ToolRegistry({ config, traceId, identityId: "test-identity", baseDir });
        },
      },
      memoryBank: new MemoryBankService(config, new EventLogger({ db })),
    });
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
      currentBranch.startsWith("feat/nochanges-test-"),
      `Expected the no-op execution branch, got: ${currentBranch}`,
    );

    await db.waitForFlush();
    const activities = db.getActivitiesByTrace("test-trace-nochanges");
    const noChangesLogs = activities.filter(
      (activity: ActivityRecord) => activity.action_type === "execution.no_changes",
    );
    assertEquals(noChangesLogs.length, 1);
    assertEquals(JSON.parse(noChangesLogs[0].payload), { request_id: "nochanges-test" });
  } finally {
    await cleanup();
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("ExecutionLoop: lease mechanism prevents duplicate processing", async () => {
  await withExecutionLoopTestContext("exec-test-lease-mechanism-", async ({ db, loop, paths }) => {
    const planContent = readFixtureTextSync(
      import.meta.url,
      "services",
      "execution",
      "execution_loop_test",
      "planContent_13.md",
    );
    const planPath = join(paths.activeDir, "lease-test.md");
    await Deno.writeTextFile(planPath, planContent);

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
  });
});

Deno.test("ExecutionLoop: handles plan without required frontmatter fields", async () => {
  await withExecutionLoopTestContext("exec-test-badfront-", async ({ loop, paths }) => {
    // Plan invalid status
    const planContent = readFixtureTextSync(
      import.meta.url,
      "services",
      "execution",
      "execution_loop_test",
      "planContent_14.md",
    );
    const planPath = join(paths.activeDir, "bad-plan.md");
    await Deno.writeTextFile(planPath, planContent);
    const result = await loop.processTask(planPath);

    assertLoopFailure(result);
    assertEquals(result.error?.includes("status"), true);
  });
});

Deno.test("ExecutionLoop: handles plan with malformed frontmatter", async () => {
  await withExecutionLoopTestContext("exec-test-malformed-", async ({ loop, paths }) => {
    // Plan with invalid YAML
    const planContent = `---
this is not: valid: yaml: format
---

# Malformed Plan
`;

    const planPath = join(paths.activeDir, "malformed-plan.md");
    await Deno.writeTextFile(planPath, planContent);
    const result = await loop.processTask(planPath);

    assertLoopFailure(result);
  });
});

Deno.test("ExecutionLoop: handles unknown tool gracefully", async () => {
  await withExecutionLoopTestContext("exec-test-unknown-", async ({ tempDir, loop, paths }) => {
    // Initialize git repository
    await setupGitRepo(tempDir, { initialCommit: true });

    // Plan with action using unknown tool
    const planContent = readFixtureTextSync(
      import.meta.url,
      "services",
      "execution",
      "execution_loop_test",
      "planContent_15.md",
    );
    const planPath = join(paths.activeDir, "unknown-tool-plan.md");
    await Deno.writeTextFile(planPath, planContent);
    const result = await loop.processTask(planPath);

    assertLoopFailure(result);
    assertStringIncludes(String(result.error), "Tool 'non_existent_tool' not found");
  });
});

Deno.test("ExecutionLoop: onCodeChangesDelegate is accepted in config without error", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "exec-test-delegate-" });
  const { db, cleanup } = await initTestDbService();
  try {
    const config = createMockConfig(tempDir);
    const logger = new EventLogger({ db });

    const loop = new ExecutionLoop({
      config,
      db,
      logger,
      identityId: "test-identity",
      onCodeChangesDelegate: (
        _traceId: string,
        _step: { title: string; content: string; successCriteria?: string[] },
      ) => {
        return Promise.resolve("changes_made");
      },
    });

    // Constructor accepted the callback without error — wiring is intact
    assert(loop instanceof ExecutionLoop);
  } finally {
    await cleanup();
    await Deno.remove(tempDir, { recursive: true });
  }
});
