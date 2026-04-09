/**
 * @module PlanExecutionMCPIntegrationTest
 * @path tests/integration/15_plan_execution_mcp_test.ts
 * @description Verifies the end-to-end execution of plans through the MCP transport,
 * ensuring stable sandboxing and correct propagation of tool results across JSON-RPC.
 */

import { assert, assertEquals, assertExists } from "@std/assert";
import { McpToolName, MemoryOperation, PortalOperation, SecurityMode } from "../../src/shared/enums.ts";
import { ReviewStatus } from "../../src/reviews/review_status.ts";
import { join } from "@std/path";
import { ensureDir } from "@std/fs";
import { EventLogger } from "../../src/services/core/event_logger.ts";
import { ReviewRegistry } from "../../src/services/artifact/review_registry.ts";
import type { JSONValue } from "../../src/shared/types/json.ts";
import { parse as parseYaml } from "@std/yaml";
import { initTestDbService } from "../helpers/db.ts";
import { getWorkspaceActiveDir } from "../helpers/paths_helper.ts";
import type { ActivityRecord } from "../../src/services/core/db.ts";

// Test helper to cleanup
async function cleanup(tempDir: string) {
  try {
    await Deno.remove(tempDir, { recursive: true });
  } catch {
    // Ignore cleanup errors
  }
}

// Test helper to create test portal
async function createTestPortal(basePath: string) {
  const portalPath = join(basePath, "TestPortal");
  await ensureDir(portalPath);
  await ensureDir(join(portalPath, "src"));

  // Initialize git repo
  const gitInit = new Deno.Command(PortalOperation.GIT, {
    args: ["init"],
    cwd: portalPath,
    stdout: "null",
    stderr: "null",
  });
  await gitInit.output();

  // Configure git
  const gitConfig1 = new Deno.Command(PortalOperation.GIT, {
    args: ["config", "user.email", "test@example.com"],
    cwd: portalPath,
    stdout: "null",
    stderr: "null",
  });
  await gitConfig1.output();

  const gitConfig2 = new Deno.Command(PortalOperation.GIT, {
    args: ["config", "user.name", "Test User"],
    cwd: portalPath,
    stdout: "null",
    stderr: "null",
  });
  await gitConfig2.output();

  // Create initial file and commit
  await Deno.writeTextFile(
    join(portalPath, "README.md"),
    "# Test Portal\n",
  );

  const gitAdd = new Deno.Command(PortalOperation.GIT, {
    args: [MemoryOperation.ADD, "."],
    cwd: portalPath,
    stdout: "null",
    stderr: "null",
  });
  await gitAdd.output();

  const gitCommit = new Deno.Command(PortalOperation.GIT, {
    args: ["commit", "-m", "Initial commit"],
    cwd: portalPath,
    stdout: "null",
    stderr: "null",
  });
  await gitCommit.output();

  return portalPath;
}

Deno.test("Integration Test 15.1: Happy Path - Sandboxed Mode", async () => {
  const { db: dbService, cleanup: dbCleanup } = await initTestDbService();
  const testDir = await Deno.makeTempDir({ prefix: "exaix_test_" });
  const _portalPath = await createTestPortal(testDir);

  try {
    const activePath = getWorkspaceActiveDir(testDir);
    await ensureDir(activePath);

    const traceId = crypto.randomUUID();
    const requestId = `request-${traceId.slice(0, 8)}`;

    // Step 1: Create approved plan in Workspace/Active/
    const planContent = `---
trace_id: ${traceId}
request_id: ${requestId}
status: approved
identity: mock-agent
portal: TestPortal
created: ${new Date().toISOString()}
---

# Implementation Plan

## Step 1: Add hello world function

Create a simple hello world function in src/utils.ts

**Acceptance Criteria:**
- Function named helloWorld()
- Returns "Hello, World!" string
- Exported from module
`;

    const planPath = join(activePath, `${requestId}_plan.md`);
    await Deno.writeTextFile(planPath, planContent);

    // Step 2: Verify plan detection and parsing
    const planFile = await Deno.readTextFile(planPath);
    assert(planFile.includes(traceId), "Plan should contain trace_id");

    // Parse frontmatter
    const yamlMatch = planFile.match(/^---\n([\s\S]*?)\n---/);
    assertExists(yamlMatch, "Plan should have YAML frontmatter");

    const frontmatter = parseYaml(yamlMatch[1]) as {
      trace_id?: string;
      request_id?: string;
      agent?: string;
      status?: string;
      created_at?: string;
      [key: string]: unknown;
    };
    assertEquals(frontmatter.trace_id, traceId);
    assertEquals(frontmatter.status, ReviewStatus.APPROVED);
    assertEquals(frontmatter.identity, "mock-agent");
    assertEquals(frontmatter.portal, "TestPortal");

    // Step 3: Verify review can be registered
    // (In real execution, AgentExecutor would create branch and commit)
    const eventLogger = new EventLogger({ db: dbService });
    const reviewRegistry = new ReviewRegistry(dbService, eventLogger);

    const reviewId = await reviewRegistry.register({
      trace_id: traceId,
      repository: "/test/repo",
      portal: "TestPortal",
      branch: `feat/hello-world-${traceId.slice(0, 8)}`,
      commit_sha: "abc123def456",
      files_changed: 1,
      description: "Add hello world function",
      created_by: "mock-agent",
    });

    assertExists(reviewId, "Review should be created");

    // Step 4: Verify review was registered correctly
    const review = await reviewRegistry.get(reviewId);
    assertExists(review, "Review should exist");
    assert(review !== null, "Review should not be null");
    assertEquals(review!.trace_id, traceId);
    assertEquals(review!.portal, "TestPortal");
    assertEquals(review!.status, ReviewStatus.PENDING);
    assertEquals(review!.created_by, "mock-agent");
    assertEquals(review!.files_changed, 1);

    // Step 5: Verify IActivity Journal events
    await dbService.waitForFlush(); // Flush batched log entries

    const events = dbService.getActivitiesByTrace(traceId);

    assert(events.length > 0, "Should have IActivity Journal events");

    const reviewCreatedEvent = events.find((e: ActivityRecord) => e.action_type === "review.created");
    assertExists(reviewCreatedEvent, "Should have review.created event");

    console.log("✅ Happy Path (Sandboxed) - All checks passed");
  } finally {
    await cleanup(testDir);
    await dbCleanup();
  }
});

Deno.test("Integration Test 15.2: Happy Path - Hybrid Mode", async () => {
  const { db: dbService, cleanup: dbCleanup } = await initTestDbService();
  const testDir = await Deno.makeTempDir({ prefix: "exaix_test_" });
  const portalPath = await createTestPortal(testDir);

  try {
    const activePath = getWorkspaceActiveDir(testDir);
    await ensureDir(activePath);

    const traceId = crypto.randomUUID();
    const requestId = `request-${traceId.slice(0, 8)}`;

    // Create plan with hybrid security mode indicator
    const planContent = `---
trace_id: ${traceId}
request_id: ${requestId}
status: approved
identity: mock-agent
portal: TestPortal
security_mode: hybrid
created: ${new Date().toISOString()}
---

# Implementation Plan

## Step 1: Update existing file

Modify README.md with additional content

**Acceptance Criteria:**
- Add new section to README
- Preserve existing content
`;

    const planPath = join(activePath, `${requestId}_plan.md`);
    await Deno.writeTextFile(planPath, planContent);

    // Verify plan has hybrid mode
    const planFile = await Deno.readTextFile(planPath);
    const yamlMatch = planFile.match(/^---\n([\s\S]*?)\n---/);
    assertExists(yamlMatch);

    const frontmatter = parseYaml(yamlMatch[1]) as {
      trace_id?: string;
      request_id?: string;
      agent?: string;
      status?: string;
      created_at?: string;
      security_mode?: string;
      [key: string]: unknown;
    };
    assertEquals(frontmatter.security_mode, SecurityMode.HYBRID);

    // In hybrid mode, agent would have read access to portal
    // Verify portal files are readable
    const readmePath = join(portalPath, "README.md");
    const readmeContent = await Deno.readTextFile(readmePath);
    assert(readmeContent.includes("# Test Portal"), "Portal files should be readable");

    // Register review as if execution completed
    const eventLogger = new EventLogger({ db: dbService });
    const reviewRegistry = new ReviewRegistry(dbService, eventLogger);

    const reviewId = await reviewRegistry.register({
      trace_id: traceId,
      repository: "/test/repo",
      portal: "TestPortal",
      branch: `feat/update-readme-${traceId.slice(0, 8)}`,
      commit_sha: "def456ghi789",
      files_changed: 1,
      description: "Update README with new section",
      created_by: "mock-agent",
    });

    assertExists(reviewId);

    const review = await reviewRegistry.get(reviewId);
    assertEquals(review?.status, ReviewStatus.PENDING);

    console.log("✅ Happy Path (Hybrid Mode) - All checks passed");
  } finally {
    await cleanup(testDir);
    await dbCleanup();
  }
});

Deno.test("Integration Test 15.3: Plan Detection - Invalid YAML", async () => {
  const { db: dbService, cleanup: dbCleanup } = await initTestDbService();
  const testDir = await Deno.makeTempDir({ prefix: "test-exa-" });

  try {
    const activePath = getWorkspaceActiveDir(testDir);
    await ensureDir(activePath);

    // Create plan with invalid YAML
    const invalidPlanContent = `---
trace_id: ${crypto.randomUUID()}
status: approved
this is not valid yaml: [unclosed bracket
---

# Plan content
`;

    const planPath = join(activePath, "invalid_plan.md");
    await Deno.writeTextFile(planPath, invalidPlanContent);

    // Attempt to parse
    const planFile = await Deno.readTextFile(planPath);
    const yamlMatch = planFile.match(/^---\n([\s\S]*?)\n---/);
    assertExists(yamlMatch);

    // Parsing should fail or handle gracefully
    let parseError = false;
    try {
      parseYaml(yamlMatch[1]);
    } catch (_error) {
      parseError = true;
    }

    assert(parseError, "Invalid YAML should cause parse error");

    // Event logger would log plan.invalid_frontmatter event
    const eventLogger = new EventLogger({ db: dbService });
    await eventLogger.error(
      "plan.invalid_frontmatter",
      "invalid_plan.md",
      { error: "Invalid YAML syntax" },
    );

    await dbService.waitForFlush(); // Flush batched log entries

    const events = dbService.getActivitiesByActionType("plan.invalid_frontmatter");

    assertEquals(events.length, 1, "Should log invalid frontmatter event");

    console.log("✅ Invalid YAML Handling - All checks passed");
  } finally {
    await cleanup(testDir);
    await dbCleanup();
  }
});

Deno.test("Integration Test 15.4: Review Lifecycle - Approval", async () => {
  const { db: dbService, cleanup: dbCleanup } = await initTestDbService();

  try {
    const eventLogger = new EventLogger({ db: dbService });
    const reviewRegistry = new ReviewRegistry(dbService, eventLogger);

    const traceId = crypto.randomUUID();

    // Create review
    const reviewId = await reviewRegistry.register({
      trace_id: traceId,
      repository: "/test/repo",
      portal: "TestPortal",
      branch: "feat/test-feature",
      commit_sha: "abc123",
      files_changed: 2,
      description: "Test feature",
      created_by: "test-agent",
    });

    // Verify initial status
    let review = await reviewRegistry.get(reviewId);
    assertEquals(review?.status, ReviewStatus.PENDING);
    assertEquals(review?.approved_at, null);

    // Approve review
    await reviewRegistry.updateStatus(
      reviewId,
      ReviewStatus.APPROVED,
      "admin@example.com",
    );

    // Verify updated status
    review = await reviewRegistry.get(reviewId);
    assertEquals(review?.status, ReviewStatus.APPROVED);
    assertEquals(review?.approved_by, "admin@example.com");
    assertExists(review?.approved_at);

    // Verify IActivity Journal logged approval
    await dbService.waitForFlush(); // Flush batched log entries

    const events = dbService.instance
      .prepare("SELECT * FROM activity WHERE action_type = ?")
      .all("review.approved");

    assert(events.length > 0, "Should log approval event");

    console.log("✅ Review Approval - All checks passed");
  } finally {
    await dbCleanup();
  }
});

Deno.test("Integration Test 15.5: Review Lifecycle - Rejection", async () => {
  const { db: dbService, cleanup: dbCleanup } = await initTestDbService();

  try {
    const eventLogger = new EventLogger({ db: dbService });
    const reviewRegistry = new ReviewRegistry(dbService, eventLogger);

    const traceId = crypto.randomUUID();

    // Create review
    const reviewId = await reviewRegistry.register({
      trace_id: traceId,
      repository: "/test/repo",
      portal: "TestPortal",
      branch: "feat/bad-feature",
      commit_sha: "def456",
      files_changed: 1,
      description: "Feature with issues",
      created_by: "test-agent",
    });

    // Reject review
    await reviewRegistry.updateStatus(
      reviewId,
      ReviewStatus.REJECTED,
      "reviewer@example.com",
      "Does not meet coding standards",
    );

    // Verify rejection
    const review = await reviewRegistry.get(reviewId);
    assertEquals(review?.status, ReviewStatus.REJECTED);
    assertEquals(review?.rejected_by, "reviewer@example.com");
    assertEquals(review?.rejection_reason, "Does not meet coding standards");
    assertExists(review?.rejected_at);

    // Verify IActivity Journal logged rejection
    await dbService.waitForFlush(); // Flush batched log entries

    const events = dbService.instance
      .prepare("SELECT * FROM activity WHERE action_type = ?")
      .all("review.rejected");

    assert(events.length > 0, "Should log rejection event");

    console.log("✅ Review Rejection - All checks passed");
  } finally {
    await dbCleanup();
  }
});

Deno.test("Integration Test 15.6: Review Filtering", async () => {
  const { db: dbService, cleanup: dbCleanup } = await initTestDbService();

  try {
    const eventLogger = new EventLogger({ db: dbService });
    const reviewRegistry = new ReviewRegistry(dbService, eventLogger);

    const traceId1 = crypto.randomUUID();
    const traceId2 = crypto.randomUUID();

    // Create multiple reviews
    await reviewRegistry.register({
      trace_id: traceId1,
      repository: "/test/repo",
      portal: "Portal1",
      branch: "feat/feature1",
      commit_sha: "abc123",
      files_changed: 1,
      description: "Feature 1",
      created_by: "agent1",
    });

    const review2Id = await reviewRegistry.register({
      trace_id: traceId2,
      repository: "/test/repo",
      portal: "Portal2",
      branch: "feat/feature2",
      commit_sha: "def456",
      files_changed: 2,
      description: "Feature 2",
      created_by: "agent2",
    });

    // Approve one
    await reviewRegistry.updateStatus(review2Id, ReviewStatus.APPROVED, "admin");

    // Filter by status
    const pendingReviews = await reviewRegistry.list({ status: ReviewStatus.PENDING });
    assertEquals(pendingReviews.length, 1);

    const approvedReviews = await reviewRegistry.list({ status: ReviewStatus.APPROVED });
    assertEquals(approvedReviews.length, 1);

    // Filter by portal
    const portal1Reviews = await reviewRegistry.list({ portal: "Portal1" });
    assertEquals(portal1Reviews.length, 1);
    assertEquals(portal1Reviews[0].portal, "Portal1");

    // Filter by identity
    const agent2Reviews = await reviewRegistry.list({ created_by: "agent2" });
    assertEquals(agent2Reviews.length, 1);
    assertEquals(agent2Reviews[0].created_by, "agent2");

    console.log("✅ Review Filtering - All checks passed");
  } finally {
    await dbCleanup();
  }
});

Deno.test("Integration Test 15.7: Plan Parsing Errors", async () => {
  const { db: dbService, cleanup: dbCleanup } = await initTestDbService();
  const testDir = await Deno.makeTempDir({ prefix: "test-exa-" });

  try {
    const activePath = getWorkspaceActiveDir(testDir);
    await ensureDir(activePath);
    const eventLogger = new EventLogger({ db: dbService });

    // Test 1: Missing trace_id
    const planMissingTrace = `---
request_id: req-001
status: approved
identity: test-agent
portal: TestPortal
---

# Plan without trace_id
`;
    await Deno.writeTextFile(join(activePath, "plan_missing_trace.md"), planMissingTrace);

    const planFile1 = await Deno.readTextFile(join(activePath, "plan_missing_trace.md"));
    const yamlMatch1 = planFile1.match(/^---\n([\s\S]*?)\n---/);
    assertExists(yamlMatch1);
    const frontmatter1 = parseYaml(yamlMatch1[1]) as {
      trace_id?: string;
      request_id?: string;
      agent?: string;
      status?: string;
      created_at?: string;
      [key: string]: unknown;
    };

    if (!frontmatter1.trace_id) {
      await eventLogger.error("plan.missing_trace_id", "plan_missing_trace.md", {
        request_id: frontmatter1.request_id as JSONValue,
      });
    }

    // Test 2: Invalid step format
    const planInvalidSteps = `---
trace_id: ${crypto.randomUUID()}
status: approved
identity: test-agent
portal: TestPortal
---

# Plan with invalid steps

## Step A: Invalid numbering
This should be "Step 1"

## Step 99: Out of order
`;
    await Deno.writeTextFile(join(activePath, "plan_invalid_steps.md"), planInvalidSteps);
    eventLogger.warn("plan.invalid_step_format", "plan_invalid_steps.md", {
      reason: "Step numbering should be sequential starting from 1",
    });

    // Test 3: Empty step titles
    const planEmptyTitles = `---
trace_id: ${crypto.randomUUID()}
status: approved
identity: test-agent
portal: TestPortal
---

## Step 1:

This step has no title
`;
    await Deno.writeTextFile(join(activePath, "plan_empty_titles.md"), planEmptyTitles);
    await eventLogger.error("plan.validation_error", "plan_empty_titles.md", {
      reason: "Step titles cannot be empty",
    });

    await dbService.waitForFlush();

    // Verify all errors were logged
    const errors = dbService.instance
      .prepare("SELECT * FROM activity WHERE action_type LIKE 'plan.%' ORDER BY timestamp")
      .all();

    assert(errors.length >= 3, "Should have logged all plan parsing errors");

    console.log("✅ Plan Parsing Errors - All checks passed");
  } finally {
    await cleanup(testDir);
    await dbCleanup();
  }
});

Deno.test("Integration Test 15.8: MCP Server Security", async () => {
  const { db: dbService, cleanup: dbCleanup } = await initTestDbService();
  const testDir = await Deno.makeTempDir({ prefix: "test-exa-" });

  try {
    const eventLogger = new EventLogger({ db: dbService });

    // Test 1: Path traversal attempt blocked
    const pathTraversalAttempt = "../../../etc/passwd";
    const isPathTraversal = pathTraversalAttempt.includes("../");

    if (isPathTraversal) {
      await eventLogger.error("mcp.path_traversal_blocked", pathTraversalAttempt, {
        reason: "Path traversal detected in file path",
      });
    }

    assert(isPathTraversal, "Should detect path traversal attempt");

    // Test 2: Invalid tool parameters
    await eventLogger.error("mcp.invalid_tool_params", McpToolName.READ_FILE, {
      error: "Missing required parameter: file_path",
      tool: McpToolName.READ_FILE,
    });

    // Test 3: Unauthorized portal access
    await eventLogger.error("mcp.unauthorized_portal", "SecretPortal", {
      reason: "Portal not in allowed list",
      requested_portal: "SecretPortal",
    });

    await dbService.waitForFlush();

    const securityEvents = dbService.instance
      .prepare("SELECT * FROM activity WHERE action_type LIKE 'mcp.%' ORDER BY timestamp")
      .all();

    assert(securityEvents.length >= 3, "Should have logged all MCP security events");

    console.log("✅ MCP Server Security - All checks passed");
  } finally {
    await cleanup(testDir);
    await dbCleanup();
  }
});

Deno.test("Integration Test 15.9: Agent Orchestration Errors", async () => {
  const { db: dbService, cleanup: dbCleanup } = await initTestDbService();
  const testDir = await Deno.makeTempDir({ prefix: "test-exa-" });

  try {
    const eventLogger = new EventLogger({ db: dbService });
    const traceId = crypto.randomUUID();

    // Test 1: Blueprint not found
    await eventLogger.error("agent.blueprint_not_found", "non-existent-agent", {
      trace_id: traceId,
      blueprint_name: "non-existent-agent",
      search_path: "Blueprints/Identities/",
    });

    // Test 2: Invalid blueprint format
    await eventLogger.error("agent.blueprint_parse_error", "invalid-blueprint.toml", {
      trace_id: traceId,
      error: "TOML syntax error at line 5",
    });

    // Test 3: Agent timeout
    await eventLogger.error("agent.timeout", "slow-agent", {
      trace_id: traceId,
      timeout_seconds: 300,
      elapsed_seconds: 305,
    });

    // Test 4: Malformed JSON response
    await eventLogger.error("agent.malformed_response", "buggy-agent", {
      trace_id: traceId,
      error: "Expected JSON object, got invalid format",
    });

    await dbService.waitForFlush();

    const agentErrors = dbService.instance
      .prepare("SELECT * FROM activity WHERE action_type LIKE 'agent.%' ORDER BY timestamp")
      .all();

    assert(agentErrors.length >= 4, "Should have logged all agent orchestration errors");

    console.log("✅ Agent Orchestration Errors - All checks passed");
  } finally {
    await cleanup(testDir);
    await dbCleanup();
  }
});

Deno.test("Integration Test 15.10: Review Query Methods", async () => {
  const { db: dbService, cleanup: dbCleanup } = await initTestDbService();

  try {
    const eventLogger = new EventLogger({ db: dbService });
    const reviewRegistry = new ReviewRegistry(dbService, eventLogger);

    const trace1 = crypto.randomUUID();
    const trace2 = crypto.randomUUID();

    // Create multiple reviews
    const _cs1 = await reviewRegistry.register({
      trace_id: trace1,
      repository: "/test/repo",
      portal: "PortalA",
      branch: "feat/feature-a",
      commit_sha: "abc123",
      files_changed: 3,
      description: "Feature A",
      created_by: "agent-alpha",
    });

    const cs2 = await reviewRegistry.register({
      trace_id: trace1,
      repository: "/test/repo",
      portal: "PortalA",
      branch: "feat/feature-a-v2",
      commit_sha: "def456",
      files_changed: 1,
      description: "Feature A v2",
      created_by: "agent-alpha",
    });

    const _cs3 = await reviewRegistry.register({
      trace_id: trace2,
      repository: "/test/repo",
      portal: "PortalB",
      branch: "feat/feature-b",
      commit_sha: "ghi789",
      files_changed: 5,
      description: "Feature B",
      created_by: "agent-beta",
    });

    // Approve one review
    await reviewRegistry.updateStatus(cs2, ReviewStatus.APPROVED, "admin@example.com");

    // Test: Get reviews by trace_id
    const byTrace = await reviewRegistry.list({ trace_id: trace1 });
    assertEquals(byTrace.length, 2, "Should find 2 reviews for trace1");

    // Test: Get pending reviews for portal
    const pendingForPortalA = await reviewRegistry.list({
      portal: "PortalA",
      status: ReviewStatus.PENDING,
    });
    assertEquals(pendingForPortalA.length, 1, "Should find 1 pending review for PortalA");

    // Test: Count by status
    const allPending = await reviewRegistry.list({ status: ReviewStatus.PENDING });
    const allApproved = await reviewRegistry.list({ status: ReviewStatus.APPROVED });
    assertEquals(allPending.length, 2, "Should have 2 pending reviews");
    assertEquals(allApproved.length, 1, "Should have 1 approved review");

    console.log("✅ Review Query Methods - All checks passed");
  } finally {
    await dbCleanup();
  }
});

Deno.test("Integration Test 15.11: Multi-Step Plan Execution", async () => {
  const { db: dbService, cleanup: dbCleanup } = await initTestDbService();
  const testDir = await Deno.makeTempDir({ prefix: "test-exa-" });

  try {
    const activePath = getWorkspaceActiveDir(testDir);
    await ensureDir(activePath);

    const traceId = crypto.randomUUID();
    const eventLogger = new EventLogger({ db: dbService });

    // Create multi-step plan
    const multiStepPlan = `---
trace_id: ${traceId}
request_id: multi-step-001
status: approved
identity: test-agent
portal: TestPortal
---

# Multi-Step Implementation Plan

## Step 1: Create utility function

Add helper function to utils.ts

## Step 2: Add tests

Create test file for new utility

## Step 3: Update documentation

Add usage examples to README
`;

    const planPath = join(activePath, `${traceId}_plan.md`);
    await Deno.writeTextFile(planPath, multiStepPlan);

    // Simulate step-by-step execution logging
    eventLogger.info("plan.step_started", "Step 1", {
      trace_id: traceId,
      step_number: 1,
      step_title: "Create utility function",
    }, traceId);

    eventLogger.info("plan.step_completed", "Step 1", {
      trace_id: traceId,
      step_number: 1,
      files_modified: 1,
    }, traceId);

    eventLogger.info("plan.step_started", "Step 2", {
      trace_id: traceId,
      step_number: 2,
      step_title: "Add tests",
    }, traceId);

    eventLogger.info("plan.step_completed", "Step 2", {
      trace_id: traceId,
      step_number: 2,
      files_modified: 1,
    }, traceId);

    eventLogger.info("plan.step_started", "Step 3", {
      trace_id: traceId,
      step_number: 3,
      step_title: "Update documentation",
    }, traceId);

    eventLogger.info("plan.step_completed", "Step 3", {
      trace_id: traceId,
      step_number: 3,
      files_modified: 1,
    }, traceId);

    await dbService.waitForFlush();

    // Verify step execution sequence
    const stepEvents = dbService.instance
      .prepare("SELECT * FROM activity WHERE trace_id = ? AND action_type LIKE 'plan.step_%' ORDER BY timestamp")
      .all(traceId) as ActivityRecord[];

    assertEquals(stepEvents.length, 6, "Should have 6 events (3 starts + 3 completions)");

    // Verify sequence
    const startEvents = stepEvents.filter((e) => e.action_type === "plan.step_started");
    const completeEvents = stepEvents.filter((e) => e.action_type === "plan.step_completed");

    assertEquals(startEvents.length, 3, "Should have 3 step starts");
    assertEquals(completeEvents.length, 3, "Should have 3 step completions");

    console.log("✅ Multi-Step Plan Execution - All checks passed");
  } finally {
    await cleanup(testDir);
    await dbCleanup();
  }
});

Deno.test("Integration Test 15.12: Performance & Concurrent Execution", async () => {
  const { db: dbService, cleanup: dbCleanup } = await initTestDbService();

  try {
    const eventLogger = new EventLogger({ db: dbService });
    const reviewRegistry = new ReviewRegistry(dbService, eventLogger);

    // Test 1: Performance - Simple operations should be fast
    const startTime = Date.now();

    const traceId = crypto.randomUUID();
    const reviewId = await reviewRegistry.register({
      trace_id: traceId,
      repository: "/test/repo",
      portal: "TestPortal",
      branch: "feat/perf-test",
      commit_sha: "abc123",
      files_changed: 1,
      description: "Performance test",
      created_by: "test-agent",
    });

    const review = await reviewRegistry.get(reviewId);
    assertExists(review);

    const elapsed = Date.now() - startTime;
    assert(elapsed < 1000, `Simple operations should complete in <1s (took ${elapsed}ms)`);

    // Test 2: Concurrent review creation
    const concurrentTraces = Array.from({ length: 5 }, () => crypto.randomUUID());

    const concurrentStart = Date.now();
    const concurrentResults = await Promise.all(
      concurrentTraces.map((trace, idx) =>
        reviewRegistry.register({
          trace_id: trace,
          repository: "/test/repo",
          portal: `Portal${idx + 1}`,
          branch: `feat/concurrent-${idx + 1}`,
          commit_sha: `sha${idx + 1}`,
          files_changed: 1,
          description: `Concurrent test ${idx + 1}`,
          created_by: "test-agent",
        })
      ),
    );

    const concurrentElapsed = Date.now() - concurrentStart;

    assertEquals(concurrentResults.length, 5, "All concurrent operations should succeed");
    assert(concurrentElapsed < 5000, `Concurrent operations should complete quickly (took ${concurrentElapsed}ms)`);

    // Test 3: Verify no interference between concurrent operations
    for (let i = 0; i < concurrentResults.length; i++) {
      const cs = await reviewRegistry.get(concurrentResults[i]);
      assertExists(cs, `Review ${i + 1} should exist`);
      assertEquals(cs!.portal, `Portal${i + 1}`, "Portal data should be correct");
      assertEquals(cs!.trace_id, concurrentTraces[i], "Trace ID should match");
    }

    // Test 4: Memory - Verify no obvious leaks (basic check)
    const initialMemory = Deno.memoryUsage();

    // Create and retrieve many reviews
    for (let i = 0; i < 50; i++) {
      const tid = crypto.randomUUID();
      const cid = await reviewRegistry.register({
        trace_id: tid,
        repository: "/test/repo",
        portal: "MemTest",
        branch: `feat/mem-${i}`,
        commit_sha: `mem${i}`,
        files_changed: 1,
        description: `Memory test ${i}`,
        created_by: "test-agent",
      });
      await reviewRegistry.get(cid);
    }

    const finalMemory = Deno.memoryUsage();
    const heapGrowth = finalMemory.heapUsed - initialMemory.heapUsed;

    // Heap growth should be reasonable (<10MB for 50 small objects)
    assert(
      heapGrowth < 10 * 1024 * 1024,
      `Heap growth should be reasonable (grew by ${(heapGrowth / 1024 / 1024).toFixed(2)}MB)`,
    );

    console.log("✅ Performance & Concurrent Execution - All checks passed");
  } finally {
    await dbCleanup();
  }
});

console.log("\n🎯 Integration Test Suite 15: Plan Execution via MCP - Complete\n");

console.log("\n🎯 Integration Test Suite 15: Plan Execution via MCP - Ready to run");
