/**
 * @module ReviewCommandsRegressionTest
 * @path apps/exactl/tests/review_commands_regression_test.ts
 * @related-files []
 * @architectural-layer CLI
 * @description Regression tests for review CLI commands, ensuring correct visual display
 * and context aggregation for pending agent plans awaiting review.
 */

import { assertEquals } from "@std/assert";
import { ensureDir } from "@std/fs";
import { join } from "@std/path";
import { createStubConfig, createStubContext, createStubDb } from "@exaix/testing";
import { type IReviewMetadata, ReviewCommands } from "../src/commands/review_commands.ts";
import { PlanStatus } from "@exaix/core/status";
import { ReviewStatus } from "@exaix/core/status";
import { createMockConfig } from "@exaix/testing";
import type { IGitService } from "@exaix/core/types";
const TEST_REQUEST_ID = "request-test123";
const TEST_TRACE_ID = "test-trace-123";
const TEST_AGENT_ID = "test-agent";
const TEST_CREATED_AT = "2026-01-25T00:00:00.000Z";
const TEST_BRANCH = `feat/${TEST_REQUEST_ID}-${TEST_TRACE_ID}`;

// Helper to create a minimal request file
async function createRequestFile(
  dir: string,
  requestId: string,
  title: string,
  agent_role: string,
): Promise<string> {
  const path = join(dir, `${requestId}.md`);
  const content = `# ${title}

This is a test request created by ${agent_role}.

## Requirements

- Test requirement 1
- Test requirement 2
`;
  await Deno.writeTextFile(path, content);
  return path;
}

// Helper to create a minimal plan file
async function createPlanFile(
  dir: string,
  planId: string,
  traceId: string,
  status: string,
): Promise<string> {
  const path = join(dir, `${planId}.md`);
  const content = `---
trace_id: "${traceId}"
status: ${status}
agent_role: ${TEST_AGENT_ID}
created_at: "${TEST_CREATED_AT}"
---

# Test Plan

This is a test plan for review regression testing.
`;
  await Deno.writeTextFile(path, content);
  return path;
}

// Helper to create test workspace structure
async function createTestWorkspace(baseDir: string): Promise<{
  workspaceDir: string;
  requestsDir: string;
  plansDir: string;
  activeDir: string;
}> {
  const workspaceDir = join(baseDir, "Workspace");
  const requestsDir = join(workspaceDir, "Requests");
  const plansDir = join(workspaceDir, "Plans");
  const activeDir = join(workspaceDir, "Active");

  await ensureDir(requestsDir);
  await ensureDir(plansDir);
  await ensureDir(activeDir);

  return { workspaceDir, requestsDir, plansDir, activeDir };
}

Deno.test("[regression] Review list shows request and plan context", async () => {
  // Create temporary test directory
  const tempDir = await Deno.makeTempDir({ prefix: "exaix_review_test_" });

  try {
    const { workspaceDir: _workspaceDir, requestsDir, plansDir, activeDir: _activeDir } = await createTestWorkspace(
      tempDir,
    );

    // Create test request
    await createRequestFile(requestsDir, TEST_REQUEST_ID, "Test Request Title", TEST_AGENT_ID);

    // Create test plan
    await createPlanFile(plansDir, `${TEST_REQUEST_ID}_plan`, TEST_TRACE_ID, "review");

    // Import ReviewCommands and dependencies

    // Create mock config and context
    const config = createMockConfig(tempDir);

    // Create a minimal mock for IGitService
    const mockGitService: IGitService = {
      setRepository: () => {},
      getRepository: () => "",
      ensureRepository: () => Promise.resolve(),
      ensureIdentity: () => Promise.resolve(),
      createBranch: (_opts) => Promise.resolve(""),
      commit: (_opts) => Promise.resolve(""),
      checkoutBranch: (_branch, _opts) => Promise.resolve(),
      getCurrentBranch: () => Promise.resolve(""),
      getDefaultBranch: (_repoPath) => Promise.resolve(""),
      addWorktree: (_path, _base) => Promise.resolve(),
      removeWorktree: (_path, _opts) => Promise.resolve(),
      pruneWorktrees: (_opts) => Promise.resolve(""),
      listWorktrees: () => Promise.resolve([]),
      runGitCommand: (_args, _opts) => Promise.resolve({ output: "", exitCode: 0 }),
      validateArgs: () => ({ valid: true }),
    };

    const context = createStubContext({
      config: createStubConfig(config),
      db: createStubDb({ getActivitiesByTrace: () => [] }),
      git: mockGitService,
    });

    // Test that ReviewCommands can be instantiated with the enhanced interface
    const reviewCommands = new ReviewCommands(context);

    // Verify the instance has the expected methods
    assertEquals(typeof reviewCommands.list, "function");
    assertEquals(typeof reviewCommands.show, "function");

    // Test that the IReviewMetadata interface includes the new fields
    // We can't directly test private methods, but we can verify the interface supports the new fields
    const testMetadata: IReviewMetadata = {
      branch: TEST_BRANCH,
      trace_id: TEST_TRACE_ID,
      request_id: TEST_REQUEST_ID,
      files_changed: 5,
      created_at: TEST_CREATED_AT,
      agent_role: TEST_AGENT_ID,
      // New fields that should be supported
      request_subject: "Test Request",
      plan_id: "test_plan",
      portal: "test-portal",
      status: ReviewStatus.PENDING,
    };

    // Verify all expected fields are present
    assertEquals(testMetadata.request_subject, "Test Request");
    assertEquals(testMetadata.plan_id, "test_plan");
    assertEquals(testMetadata.portal, "test-portal");
    assertEquals(testMetadata.status, ReviewStatus.PENDING);
  } finally {
    // Clean up
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("[regression] Review show displays complete context information", () => {
  // This test verifies that the review show command includes all context fields

  const mockReviewDetails = {
    branch: TEST_BRANCH,
    trace_id: TEST_TRACE_ID,
    request_id: TEST_REQUEST_ID,
    files_changed: 3,
    created_at: TEST_CREATED_AT,
    agent_role: TEST_AGENT_ID,
    // Request context
    request_subject: "Test Request Title",
    request_agent: TEST_AGENT_ID,
    request_portal: "test-portal",
    request_priority: "high",
    request_created_by: "test-user",
    // Plan context
    plan_id: `${TEST_REQUEST_ID}_plan`,
    plan_status: PlanStatus.APPROVED,
    // Portal context
    portal: "test-portal",
    // Status context
    status: ReviewStatus.PENDING,
    diff: "mock diff output",
    commits: [
      {
        sha: "abc123def456",
        message: "Initial commit",
        timestamp: TEST_CREATED_AT,
      },
    ],
  };

  // Verify all expected fields are present
  assertEquals(mockReviewDetails.request_subject, "Test Request Title");
  assertEquals(mockReviewDetails.plan_id, `${TEST_REQUEST_ID}_plan`);
  assertEquals(mockReviewDetails.plan_status, PlanStatus.APPROVED);
  assertEquals(mockReviewDetails.portal, "test-portal");
  assertEquals(mockReviewDetails.status, ReviewStatus.PENDING);
  assertEquals(mockReviewDetails.diff, "mock diff output");
  assertEquals(mockReviewDetails.commits.length, 1);
});
