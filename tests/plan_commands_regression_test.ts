/**
 * @module PlanCommandsRegressionTest
 * @path tests/plan_commands_regression_test.ts
 * @description Regression tests for plan command logic, ensuring that plan files are
 * correctly discovered across Active, Rejected, and Pending directory hierarchies.
 */

import { assertEquals } from "@std/assert";
import { ensureDir } from "@std/fs";
import { join } from "@std/path";
import { createStubContext, createStubDb } from "../helpers/test_helpers.ts";
import { createStubConfig } from "../helpers/test_helpers.ts";
import { ExaPathDefaults } from "../src/shared/constants.ts";
import { PlanStatus } from "../src/shared/status/plan_status.ts";
import type { IPlanMetadata } from "../src/shared/types/plan.ts";
import { PlanCommands } from "../src/cli/commands/plan_commands.ts";
import { ConfigSchema } from "../src/shared/schemas/config.ts";
import { LogLevel } from "../src/shared/enums.ts";

const TEST_AGENT_ID = "test-agent";
const TEST_CREATED_AT = "2026-01-17T00:00:00.000Z";
const TEST_PLAN_FILE = "test_plan.md";
const TEST_PLAN_REJECTED_FILE = "test_plan_rejected.md";

// Helper to create a minimal plan file
async function createPlanFile(
  dir: string,
  filename: string,
  status: string,
  traceId: string,
): Promise<string> {
  const path = join(dir, filename);
  const content = `---
trace_id: "${traceId}"
status: ${status}
identity_id: ${TEST_AGENT_ID}
created_at: "${TEST_CREATED_AT}"
---

# Test Plan

This is a test plan for regression testing.
`;
  await Deno.writeTextFile(path, content);
  return path;
}

// Helper to create test workspace structure
async function createTestWorkspace(baseDir: string): Promise<{
  plansDir: string;
  activeDir: string;
  rejectedDir: string;
}> {
  const plansDir = join(baseDir, "Workspace", "Plans");
  const activeDir = join(baseDir, "Workspace", "Active");
  const rejectedDir = join(baseDir, "Workspace", "Rejected");

  await ensureDir(plansDir);
  await ensureDir(activeDir);
  await ensureDir(rejectedDir);

  return { plansDir, activeDir, rejectedDir };
}

// Helper for test setup
function initPlanTest(tempDir: string) {
  const config = ConfigSchema.parse({
    system: { root: tempDir, log_level: LogLevel.INFO },
    paths: { ...ExaPathDefaults },
  });
  const stubDb = createStubDb();
  const context = createStubContext({
    config: createStubConfig(config),
    db: stubDb,
  });
  return { context };
}

// ============================================================================
// Regression Tests for Plan List Directory Scanning
// ============================================================================

Deno.test("[regression] Plan list finds approved plans in Active directory", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "exa_plan_regression_" });

  try {
    const { activeDir } = await createTestWorkspace(tempDir);

    // Create an approved plan in Active directory
    const traceId = crypto.randomUUID();
    await createPlanFile(activeDir, TEST_PLAN_FILE, PlanStatus.APPROVED, traceId);

    const { context } = initPlanTest(tempDir);
    const planCommands = new PlanCommands(context);

    // List with status=approved - should find the plan in Active directory
    const approvedPlans = await planCommands.list(PlanStatus.APPROVED);

    // Before the fix, this would return 0 plans (only scanned Plans directory)
    // After the fix, this should return 1 plan (scans Active directory for approved)
    assertEquals(approvedPlans.length, 1, "Should find 1 approved plan in Active directory");
    assertEquals(approvedPlans[0].status, PlanStatus.APPROVED);
    assertEquals(approvedPlans[0].trace_id, traceId);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("[regression] Plan list finds rejected plans in Rejected directory", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "exa_plan_regression_" });

  try {
    const { rejectedDir } = await createTestWorkspace(tempDir);

    // Create a rejected plan in Rejected directory
    const traceId = crypto.randomUUID();
    await createPlanFile(rejectedDir, TEST_PLAN_REJECTED_FILE, PlanStatus.REJECTED, traceId);

    const { context } = initPlanTest(tempDir);
    const planCommands = new PlanCommands(context);

    // List with status=rejected - should find the plan in Rejected directory
    const rejectedPlans = await planCommands.list(PlanStatus.REJECTED);

    assertEquals(rejectedPlans.length, 1, "Should find 1 rejected plan in Rejected directory");
    assertEquals(rejectedPlans[0].status, PlanStatus.REJECTED);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("[regression] Plan list finds review plans in Plans directory", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "exa_plan_regression_" });

  try {
    const { plansDir } = await createTestWorkspace(tempDir);

    // Create a review plan in Plans directory
    const traceId = crypto.randomUUID();
    await createPlanFile(plansDir, TEST_PLAN_FILE, PlanStatus.REVIEW, traceId);
    const { context } = initPlanTest(tempDir);
    const planCommands = new PlanCommands(context);

    // List with status=review - should find the plan in Plans directory
    const reviewPlans = await planCommands.list(PlanStatus.REVIEW);

    assertEquals(reviewPlans.length, 1, "Should find 1 review plan in Plans directory");
    assertEquals(reviewPlans[0].status, PlanStatus.REVIEW);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("[regression] Plan list without filter scans all directories", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "exa_plan_regression_" });

  try {
    const { plansDir, activeDir, rejectedDir } = await createTestWorkspace(tempDir);

    // Create plans in all directories
    await createPlanFile(plansDir, "review_plan.md", PlanStatus.REVIEW, crypto.randomUUID());
    await createPlanFile(activeDir, "approved_plan.md", PlanStatus.APPROVED, crypto.randomUUID());
    await createPlanFile(rejectedDir, "rejected_plan.md", PlanStatus.REJECTED, crypto.randomUUID());

    const { context } = initPlanTest(tempDir);
    const planCommands = new PlanCommands(context);

    // List without filter - should find all 3 plans from all directories
    const allPlans = await planCommands.list();

    assertEquals(allPlans.length, 3, "Should find 3 plans across all directories");

    const statuses = allPlans.map((p: IPlanMetadata) => p.status).sort();
    assertEquals(statuses, [PlanStatus.APPROVED, PlanStatus.REJECTED, PlanStatus.REVIEW]);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("[regression] Plan list handles empty directories gracefully", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "exa_plan_regression_" });

  try {
    await createTestWorkspace(tempDir);

    // Don't create any plan files - directories are empty

    const { context } = initPlanTest(tempDir);
    const planCommands = new PlanCommands(context);

    // Should not throw, just return empty array
    const allPlans = await planCommands.list();
    assertEquals(allPlans.length, 0);

    const approvedPlans = await planCommands.list(PlanStatus.APPROVED);
    assertEquals(approvedPlans.length, 0);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

// ============================================================================
// Regression Test for Plan Rejection Directory Scanning
// ============================================================================

/**
 * Regression test for: "Plan not found" error when rejecting plans after review rejection
 * Root cause: reject() method only searched Workspace/Plans directory, but plans could be in other directories after review operations
 * Fix: Updated reject() to search all directories like show() and list() methods
 */
Deno.test("[regression] Plan reject finds plans in any directory", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "exa_plan_reject_regression_" });

  try {
    const { activeDir, rejectedDir } = await createTestWorkspace(tempDir);

    // Create plans in Active and Rejected directories (simulating post-review state)
    const activePlanId = "active_plan_123";
    const rejectedPlanId = "rejected_plan_456";

    await createPlanFile(activeDir, `${activePlanId}.md`, PlanStatus.APPROVED, crypto.randomUUID());
    await createPlanFile(rejectedDir, `${rejectedPlanId}_rejected.md`, PlanStatus.REJECTED, crypto.randomUUID());

    const { context } = initPlanTest(tempDir);
    const planCommands = new PlanCommands(context);

    // Before the fix: reject() would only search Workspace/Plans directory
    // After the fix: reject() searches all directories like show() and list()

    // Test rejecting a plan from Active directory - should succeed (not throw "Plan not found")
    await planCommands.reject(activePlanId, "Test rejection reason");

    // Verify the plan was moved to Rejected directory with _rejected suffix
    const rejectedPath = join(rejectedDir, `${activePlanId}_rejected.md`);
    const planExists = await Deno.stat(rejectedPath).then(() => true).catch(() => false);
    assertEquals(planExists, true, "Plan should be moved to Rejected directory with _rejected suffix after rejection");

    // Test rejecting a plan from Rejected directory - should also succeed (not throw "Plan not found")
    await planCommands.reject(rejectedPlanId, "Another rejection reason");

    // The main point is that both rejections succeeded without "Plan not found" error
    // This proves the fix works - reject() can now find plans in any directory
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

// ============================================================================
// Regression Test for Plan Request Context
// ============================================================================

/**
 * Regression test for: "exactl plan show/list Missing Request and Agent Context"
 * Root cause: Plan commands only showed basic plan metadata, missing request information
 * Fix: Enhanced PlanCommands to load and display request context (agent, portal, priority, etc.)
 */
Deno.test("[regression] Plan list and show include request context information", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "exa_plan_request_context_" });

  try {
    const { plansDir } = await createTestWorkspace(tempDir);
    const requestsDir = join(tempDir, "Workspace", "Requests");
    await ensureDir(requestsDir);

    // Create a request file
    const traceId = "test-trace-123";
    const requestId = `request-${traceId}`;
    const requestPath = join(requestsDir, `${requestId}.md`);
    const requestContent = `---
trace_id: "${traceId}"
created: "2026-01-25T16:28:01.132Z"
status: planned
priority: high
identity: test-agent
portal: test-portal
created_by: test@example.com
---

# Test Request Title

This is a test request for plan context testing.
`;
    await Deno.writeTextFile(requestPath, requestContent);

    // Create a plan file that references the request
    const planId = `${requestId}_plan`;
    const planPath = join(plansDir, `${planId}.md`);
    const planContent = `---
trace_id: "${traceId}"
request_id: "${requestId}"
status: review
created_at: "2026-01-25T16:28:01.132Z"
---

# Test Plan

This plan references a request and should show request context.
`;
    await Deno.writeTextFile(planPath, planContent);

    const { context } = initPlanTest(tempDir);
    const planCommands = new PlanCommands(context);

    // Test plan list includes request context
    const plans = await planCommands.list();
    assertEquals(plans.length, 1);

    const plan = plans[0];
    assertEquals(plan.id, planId);
    assertEquals(plan.status, "review");
    assertEquals(plan.request_id, requestId);
    assertEquals(plan.request_subject, "Test Request Title");
    assertEquals(plan.request_identity, "test-agent");
    assertEquals(plan.request_portal, "test-portal");
    assertEquals(plan.request_priority, "high");
    assertEquals(plan.request_created_by, "test@example.com");

    // Test plan show includes request context
    const planDetails = await planCommands.show(planId);
    assertEquals(planDetails.metadata.id, planId);
    assertEquals(planDetails.metadata.status, "review");
    assertEquals(planDetails.metadata.request_id, requestId);
    assertEquals(planDetails.metadata.request_subject, "Test Request Title");
    assertEquals(planDetails.metadata.request_identity, "test-agent");
    assertEquals(planDetails.metadata.request_portal, "test-portal");
    assertEquals(planDetails.metadata.request_priority, "high");
    assertEquals(planDetails.metadata.request_created_by, "test@example.com");
    assertEquals(
      planDetails.content.trim(),
      "# Test Plan\n\nThis plan references a request and should show request context.",
    );
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});
