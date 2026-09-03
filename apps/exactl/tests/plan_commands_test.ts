/**
 * @module PlanCommandsTest
 * @path apps/exactl/tests/plan_commands_test.ts
 * @related-files []
 * @architectural-layer CLI
 * @description Unit and integration tests for CLI plan operations, verifying plan listing,
 * detailed diff visualization, approval workflows, and status synchronization with the Workspace.
 */

import { RequestSource } from "@exaix/core";
import { assertEquals, assertExists, assertRejects } from "@std/assert";
import { PlanStatus } from "@exaix/core/status";
import { RequestStatus } from "@exaix/core/status";

import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { join } from "@std/path";
import { PlanCommands } from "../src/commands/plan_commands.ts";
import type { DatabaseService as DatabaseService } from "@exaix/storage-sqlite";
import { createCliTestContext } from "./helpers/test_setup.ts";
import {
  getWorkspaceActiveDir,
  getWorkspaceArchiveDir,
  getWorkspacePlansDir,
  getWorkspaceRejectedDir,
  getWorkspaceRequestsDir,
} from "@exaix/testing";
import {
  PLAN_REVIEW_COMMENT_PREFIX,
  PLAN_REVIEW_COMMENTS_HEADER,
  REQUEST_REVISION_COMMENT_PREFIX,
  REQUEST_REVISION_COMMENTS_HEADER,
} from "@exaix/core";
import { readFixtureTextSync } from "@exaix/testing";

describe("PlanCommands", () => {
  let tempDir: string;
  let db: DatabaseService;
  let planCommands: PlanCommands;
  let inboxPlansDir: string;
  let activeDir: string;
  let rejectedDir: string;
  let archiveDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    // Initialize shared CLI test context
    const result = await createCliTestContext({
      createDirs: [
        "Workspace/Plans",
        "Workspace/Active",
        "Workspace/Rejected",
        "Workspace/Archive",
        "Workspace/Requests",
      ],
    });
    tempDir = result.tempDir;
    db = result.db;
    cleanup = result.cleanup;

    // Derived paths
    inboxPlansDir = getWorkspacePlansDir(tempDir);
    activeDir = getWorkspaceActiveDir(tempDir);
    rejectedDir = getWorkspaceRejectedDir(tempDir);
    archiveDir = getWorkspaceArchiveDir(tempDir);

    // Initialize PlanCommands
    planCommands = new PlanCommands(result.context);
  });

  afterEach(async () => {
    await cleanup();
  });

  describe("approve", () => {
    it("should approve a plan and move it to Workspace/Active", async () => {
      // Create a plan file with status='review'
      const planId = "test-plan-001";
      const planContent = readFixtureTextSync(
        import.meta.url,
        "cli",
        "plan_commands_test",
        "plan_001_review_plan.md",
      );
      const planPath = join(inboxPlansDir, `${planId}.md`);
      await Deno.writeTextFile(planPath, planContent);

      // Approve the plan
      await planCommands.approve(planId);

      // Verify plan moved to Workspace/Active
      const activePlanPath = join(activeDir, `${planId}.md`);
      const exists = await Deno.stat(activePlanPath).then(() => true).catch(() => false);
      assertEquals(exists, true, "Plan should be moved to Workspace/Active");

      // Verify original plan removed
      const originalExists = await Deno.stat(planPath).then(() => true).catch(() => false);
      assertEquals(originalExists, false, "Original plan should be removed");

      // Verify frontmatter updated
      const updatedContent = await Deno.readTextFile(activePlanPath);
      assertEquals(updatedContent.includes("status: approved"), true, "Status should be 'approved'");
      assertEquals(updatedContent.includes("approved_by:"), true, "Should have approved_by field");
      assertEquals(updatedContent.includes("approved_at:"), true, "Should have approved_at field");

      // Verify activity logged
      const activities = await db.getRecentActivity(10);
      const approval = activities.find((a) => a.action_type === "plan.approved" && a.target === planId);
      assertExists(approval, "Approval should be logged");
      assertExists(approval?.actor);
      assertEquals(approval?.identity_id, null);
      const approvalPayload = JSON.parse(approval?.payload || "{}");
      assertEquals(approvalPayload?.via, RequestSource.CLI);
      assertEquals(approval?.trace_id, "trace-123");
    });

    it("should reject approval if plan does not exist", async () => {
      await assertRejects(
        async () => await planCommands.approve("nonexistent-plan"),
        Error,
        "Plan not found",
      );
    });

    it("should reject approval if plan status is not 'review'", async () => {
      const planId = "test-plan-002";
      const planContent = `---
trace_id: "trace-456"
status: needs_revision
---

# Test Plan
`;
      await Deno.writeTextFile(join(inboxPlansDir, `${planId}.md`), planContent);

      await assertRejects(
        async () => await planCommands.approve(planId),
        Error,
        "Only plans with status='review' can be approved",
      );
    });

    it("should archive existing plan if target path already exists", async () => {
      const planId = "test-plan-003";
      const planContent = `---
trace_id: "trace-789"
status: review
---

# Test Plan (New)
`;
      await Deno.writeTextFile(join(inboxPlansDir, `${planId}.md`), planContent);

      // Create existing file in Active
      const existingContent = "existing file content";
      await Deno.writeTextFile(join(activeDir, `${planId}.md`), existingContent);

      // Approve should succeed now
      await planCommands.approve(planId);

      // Verify new content in Active
      const activeContent = await Deno.readTextFile(join(activeDir, `${planId}.md`));
      assertEquals(activeContent.includes("# Test Plan (New)"), true, "New plan should be in Active");

      // Verify old content archived
      const archiveDir = getWorkspaceArchiveDir(tempDir);
      const archiveEntries = [];
      for await (const entry of Deno.readDir(archiveDir)) {
        archiveEntries.push(entry);
      }

      const archivedFile = archiveEntries.find((e) => e.name.startsWith(`${planId}_archived_`));
      assertExists(archivedFile, "Old plan should be archived");

      const archivedContent = await Deno.readTextFile(join(archiveDir, archivedFile.name));
      assertEquals(archivedContent, existingContent, "Archived content should match old file");
    });
  });

  describe("reject", () => {
    it("should reject a plan with reason and move to /Workspace/Rejected", async () => {
      const planId = "test-plan-004";
      const planContent = readFixtureTextSync(
        import.meta.url,
        "cli",
        "plan_commands_test",
        "plan_004_reject_plan.md",
      );
      await Deno.writeTextFile(join(inboxPlansDir, `${planId}.md`), planContent);

      const reason = "Plan is too vague and lacks specific actions";
      await planCommands.reject(planId, reason);

      // Verify plan moved to /Workspace/Rejected with _rejected.md suffix
      const rejectedPath = join(rejectedDir, `${planId}_rejected.md`);
      const exists = await Deno.stat(rejectedPath).then(() => true).catch(() => false);
      assertEquals(exists, true, "Plan should be moved to /Workspace/Rejected");

      // Verify original plan removed
      const originalPath = join(inboxPlansDir, `${planId}.md`);
      const originalExists = await Deno.stat(originalPath).then(() => true).catch(() => false);
      assertEquals(originalExists, false, "Original plan should be removed");

      // Verify frontmatter updated
      const rejectedContent = await Deno.readTextFile(rejectedPath);
      assertEquals(rejectedContent.includes("status: rejected"), true);
      assertEquals(rejectedContent.includes("rejected_by:"), true);
      assertEquals(rejectedContent.includes("rejected_at:"), true);
      assertEquals(rejectedContent.includes(`rejection_reason: ${reason}`), true);

      // Verify activity logged
      const activities = await db.getRecentActivity(10);
      const rejection = activities.find((a) => a.action_type === "plan.rejected" && a.target === planId);
      assertExists(rejection, "Rejection should be logged");
      // Actor is now user identity (email or username) instead of "human"
      assertExists(rejection?.actor);
      const rejectionPayload = JSON.parse(rejection?.payload || "{}");
      assertEquals(rejectionPayload?.reason, reason);
      assertEquals(rejectionPayload?.via, RequestSource.CLI);
    });

    it("should reject rejection if reason is empty", async () => {
      await assertRejects(
        async () => await planCommands.reject("test-plan-005", ""),
        Error,
        "Rejection reason is required",
      );
    });

    it("should reject rejection if plan does not exist", async () => {
      await assertRejects(
        async () => await planCommands.reject("nonexistent-plan", "Some reason"),
        Error,
        "Plan not found",
      );
    });
  });

  describe("revise", () => {
    it("should request revision with single comment", async () => {
      const planId = "test-plan-006";
      const planContent = readFixtureTextSync(
        import.meta.url,
        "cli",
        "plan_commands_test",
        "plan_006_revision_plan.md",
      );
      await Deno.writeTextFile(join(inboxPlansDir, `${planId}.md`), planContent);

      const comment = "Please add more specific file paths";
      await planCommands.revise(planId, [comment]);

      // Verify file still in /Workspace/Plans
      const planPath = join(inboxPlansDir, `${planId}.md`);
      const exists = await Deno.stat(planPath).then(() => true).catch(() => false);
      assertEquals(exists, true, "Plan should remain in /Workspace/Plans");

      // Verify content updated
      const updatedContent = await Deno.readTextFile(planPath);
      assertEquals(updatedContent.includes("status: needs_revision"), true);
      assertEquals(updatedContent.includes("reviewed_by:"), true);
      assertEquals(updatedContent.includes("reviewed_at:"), true);
      assertEquals(updatedContent.includes(PLAN_REVIEW_COMMENTS_HEADER), true);
      assertEquals(updatedContent.includes(`${PLAN_REVIEW_COMMENT_PREFIX}${comment}`), true);

      // Verify activity logged
      const activities = await db.getRecentActivity(10);
      const revision = activities.find((a) => a.action_type === "plan.revision_requested" && a.target === planId);
      assertExists(revision, "Revision request should be logged");
      const revisionPayload = JSON.parse(revision?.payload || "{}");
      assertEquals(revisionPayload?.comment_count, 1);
    });

    it("should request revision with multiple comments", async () => {
      const planId = "test-plan-007";
      const planContent = `---
trace_id: "trace-ghi"
status: review
---

# Test Plan
`;
      await Deno.writeTextFile(join(inboxPlansDir, `${planId}.md`), planContent);

      const comments = [
        "Add error handling",
        "Include test cases",
        "Specify dependencies",
      ];
      await planCommands.revise(planId, comments);

      const updatedContent = await Deno.readTextFile(join(inboxPlansDir, `${planId}.md`));

      // Verify all comments present
      for (const comment of comments) {
        assertEquals(updatedContent.includes(`${PLAN_REVIEW_COMMENT_PREFIX}${comment}`), true);
      }

      // Verify activity logged with correct count
      const activities = await db.getRecentActivity(10);
      const revision = activities.find((a) => a.action_type === "plan.revision_requested");
      const revisionPayload = JSON.parse(revision?.payload || "{}");
      assertEquals(revisionPayload?.comment_count, 3);
    });

    it("should reject revision if no comments provided", async () => {
      await assertRejects(
        async () => await planCommands.revise("test-plan-008", []),
        Error,
        "At least one comment is required",
      );
    });

    it("should reject revision if plan does not exist", async () => {
      await assertRejects(
        async () => await planCommands.revise("nonexistent-plan", ["Some comment"]),
        Error,
        "Plan not found",
      );
    });

    it("should append to existing review comments section", async () => {
      const planId = "test-plan-009";
      const planContent = readFixtureTextSync(
        import.meta.url,
        "cli",
        "plan_commands_test",
        "plan_009_revision_existing_plan.md",
      );
      await Deno.writeTextFile(join(inboxPlansDir, `${planId}.md`), planContent);

      await planCommands.revise(planId, ["New comment"]);

      const updatedContent = await Deno.readTextFile(join(inboxPlansDir, `${planId}.md`));
      assertEquals(updatedContent.includes(`${PLAN_REVIEW_COMMENT_PREFIX}Previous comment`), true);
      assertEquals(updatedContent.includes(`${PLAN_REVIEW_COMMENT_PREFIX}New comment`), true);
    });

    it("should reset request status and append revision instructions", async () => {
      const planId = "test-plan-010";
      const requestId = "request-abc";
      const requestPath = join(getWorkspaceRequestsDir(tempDir), `${requestId}.md`);

      const requestContent = `---
trace_id: "trace-req"
status: ${RequestStatus.PLANNED}
priority: normal
agent_role: code-analyst
source: cli
created: "2025-11-25T10:00:00Z"
created_by: "tester"
---

# Request

Original request
`;
      await Deno.writeTextFile(requestPath, requestContent);

      const planContent = `---
trace_id: "trace-req"
request_id: "${requestId}"
status: review
---

# Test Plan
`;
      await Deno.writeTextFile(join(inboxPlansDir, `${planId}.md`), planContent);

      const comment = "Use portal src/cli for analysis";
      await planCommands.revise(planId, [comment]);

      const updatedRequest = await Deno.readTextFile(requestPath);
      assertEquals(updatedRequest.includes(`status: ${RequestStatus.PENDING}`), true);
      assertEquals(updatedRequest.includes(REQUEST_REVISION_COMMENTS_HEADER), true);
      assertEquals(updatedRequest.includes(`${REQUEST_REVISION_COMMENT_PREFIX}${comment}`), true);
    });
  });

  describe("list", () => {
    it("should list all plans with status indicators", async () => {
      // Create multiple plans
      await Deno.writeTextFile(
        join(inboxPlansDir, "plan-001.md"),
        `---
trace_id: "trace-001"
status: review
created_at: "2025-11-25T10:00:00Z"
---
# Plan 1
`,
      );

      await Deno.writeTextFile(
        join(inboxPlansDir, "plan-002.md"),
        `---
trace_id: "trace-002"
status: needs_revision
created_at: "2025-11-25T11:00:00Z"
---
# Plan 2
`,
      );

      await Deno.writeTextFile(
        join(inboxPlansDir, "plan-003.md"),
        `---
trace_id: "trace-003"
status: review
created_at: "2025-11-25T12:00:00Z"
---
# Plan 3
`,
      );

      const plans = await planCommands.list();

      assertEquals(plans.length, 3);
      assertEquals(plans[0].id, "plan-001");
      assertEquals(plans[0].status, "review");
      assertEquals(plans[1].id, "plan-002");
      assertEquals(plans[1].status, "needs_revision");
      assertEquals(plans[2].id, "plan-003");
      assertEquals(plans[2].status, "review");
    });

    it("should filter plans by status", async () => {
      await Deno.writeTextFile(
        join(inboxPlansDir, "plan-004.md"),
        `---
status: review
---
# Plan 4
`,
      );

      await Deno.writeTextFile(
        join(inboxPlansDir, "plan-005.md"),
        `---
status: needs_revision
---
# Plan 5
`,
      );

      const reviewPlans = await planCommands.list(PlanStatus.REVIEW);
      assertEquals(reviewPlans.length, 1);
      assertEquals(reviewPlans[0].id, "plan-004");

      const revisionPlans = await planCommands.list(PlanStatus.NEEDS_REVISION);
      assertEquals(revisionPlans.length, 1);
      assertEquals(revisionPlans[0].id, "plan-005");
    });

    it("should return empty array when no plans exist", async () => {
      const plans = await planCommands.list();
      assertEquals(plans.length, 0);
    });

    it("should handle malformed frontmatter gracefully", async () => {
      await Deno.writeTextFile(
        join(inboxPlansDir, "plan-malformed.md"),
        `# Plan without frontmatter`,
      );

      const plans = await planCommands.list();
      assertEquals(plans.length, 1);
      assertEquals(plans[0].id, "plan-malformed");
      assertEquals(plans[0].status, PlanStatus.REVIEW);
    });

    it("[regression] should include archived plans when filtering for approved status", async () => {
      // Use valid UUIDs for trace_id to match system expectations
      const archivedTraceId = crypto.randomUUID();
      const activeTraceId = crypto.randomUUID();

      // Create an approved plan in Archive directory (simulating completed execution)
      await Deno.writeTextFile(
        join(archiveDir, "archived-plan-001.md"),
        `---
status: approved
trace_id: "${archivedTraceId}"
---
# Archived Approved Plan
This plan was executed and archived.
`,
      );

      // Create an approved plan in Active directory (simulating running execution)
      await Deno.writeTextFile(
        join(activeDir, "active-plan-002.md"),
        `---
status: approved
trace_id: "${activeTraceId}"
---
# Active Approved Plan
This plan is currently being executed.
`,
      );

      const approvedPlans = await planCommands.list(PlanStatus.APPROVED);
      assertEquals(approvedPlans.length, 2);

      // Should include both archived and active approved plans
      const archivedPlan = approvedPlans.find((p) => p.id === "archived-plan-001");
      const activePlan = approvedPlans.find((p) => p.id === "active-plan-002");

      assertExists(archivedPlan, "Should include archived approved plan");
      assertExists(activePlan, "Should include active approved plan");
      assertEquals(archivedPlan.status, PlanStatus.APPROVED);
      assertEquals(activePlan.status, PlanStatus.APPROVED);

      // Verify trace_ids are preserved correctly
      assertEquals(archivedPlan.trace_id, archivedTraceId);
      assertEquals(activePlan.trace_id, activeTraceId);
    });
  });

  describe("show", () => {
    it("should display plan content with frontmatter", async () => {
      const planId = "test-plan-010";
      const planContent = readFixtureTextSync(
        import.meta.url,
        "cli",
        "plan_commands_test",
        "plan_010_show_plan.md",
      );
      await Deno.writeTextFile(join(inboxPlansDir, `${planId}.md`), planContent);

      const result = await planCommands.show(planId);

      assertEquals(result.metadata.id, planId);
      assertEquals(result.metadata.status, PlanStatus.REVIEW);
      assertEquals(result.metadata.trace_id, "trace-show-001");
      assertEquals(result.content.includes("# Test Plan"), true);
      assertEquals(result.content.includes("## Actions"), true);
    });

    it("should throw error if plan does not exist", async () => {
      await assertRejects(
        async () => await planCommands.show("nonexistent-plan"),
        Error,
        "Plan not found",
      );
    });

    it("should handle plan without frontmatter", async () => {
      const planId = "test-plan-011";
      const planContent = `# Plan without frontmatter

Just some content.
`;
      await Deno.writeTextFile(join(inboxPlansDir, `${planId}.md`), planContent);

      const result = await planCommands.show(planId);

      assertEquals(result.metadata.id, planId);
      assertEquals(result.metadata.status, PlanStatus.REVIEW);
      assertEquals(result.content.includes("# Plan without frontmatter"), true);
    });

    it("should show rejected plans from Workspace/Rejected directory", async () => {
      const planId = "test-rejected-plan";
      const rejectionReason = "Plan is too vague and lacks specific actions";
      const rejectedAt = "2026-01-23T15:26:47.000Z";
      const rejectedBy = "test-user@example.com";

      const planContent = `---
status: rejected
trace_id: "trace-rejected-001"
agent_role: agent-456
created_at: "2025-11-25T10:00:00Z"
rejected_at: "${rejectedAt}"
rejected_by: "${rejectedBy}"
rejection_reason: "${rejectionReason}"
---

# Rejected Test Plan

This plan was rejected for testing purposes.

## Original Actions
\`\`\`toml
- tool: file_write
  params:
    path: rejected.txt
\`\`\`
`;
      await Deno.writeTextFile(join(rejectedDir, `${planId}_rejected.md`), planContent);

      const result = await planCommands.show(planId);

      assertEquals(result.metadata.id, planId);
      assertEquals(result.metadata.status, PlanStatus.REJECTED);
      assertEquals(result.metadata.trace_id, "trace-rejected-001");
      assertEquals(result.metadata.rejected_at, rejectedAt);
      assertEquals(result.metadata.rejected_by, rejectedBy);
      assertEquals(result.metadata.rejection_reason, rejectionReason);
      assertEquals(result.content.includes("# Rejected Test Plan"), true);
    });
  });

  describe("user identity", () => {
    it("should capture user identity from git config", async () => {
      const planId = "test-plan-012";
      await Deno.writeTextFile(
        join(inboxPlansDir, `${planId}.md`),
        `---
trace_id: "trace-identity"
status: review
---
# Plan
`,
      );

      await planCommands.approve(planId);

      const activities = await db.getRecentActivity(10);
      const approval = activities.find((a) => a.action_type === "plan.approved");
      assertExists(approval?.actor, "Actor should be captured");
      assertEquals(typeof approval?.actor, "string");
    });
  });
});
