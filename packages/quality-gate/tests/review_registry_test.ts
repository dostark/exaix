/**
 * @module ReviewRegistryTest
 * @path packages/quality-gate/tests/review_registry_test.ts
 * @description Verifies the core ReviewRegistry service, ensuring stable registration and lifecycle
 * tracking for agent execution plans awaiting human or automated review.
 */

import { assertEquals, assertExists, assertRejects } from "@std/assert";
import { MemoryBankSource } from "@exaix/core";
import { DomainEventType } from "@exaix/core/events";
import { ReviewStatus } from "@exaix/core/status";
import { join } from "@std/path";

import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { ReviewRegistry } from "@exaix/core/artifact";
import { EventLogger } from "@exaix/core/logger";
import { initTestDbService } from "@exaix/testing";
import type { IRegisterReviewInput } from "@exaix/schemas/review.ts";

describe("ReviewRegistry", () => {
  let registry: ReviewRegistry;
  let logger: EventLogger;
  let cleanup: () => Promise<void>;
  let db: Awaited<ReturnType<typeof initTestDbService>>["db"];

  beforeEach(async () => {
    const testDb = await initTestDbService();
    db = testDb.db;
    cleanup = testDb.cleanup;

    logger = new EventLogger({ db });
    registry = new ReviewRegistry(db, logger);
  });

  afterEach(async () => {
    await cleanup();
  });

  // Registration Tests

  it("should register a new review", async () => {
    const input: IRegisterReviewInput = {
      trace_id: crypto.randomUUID(),
      portal: "TestPortal",
      repository: "/test/repo",
      branch: "feat/test-feature-abc123",
      commit_sha: "abc1234567890abcdef1234567890abcdef12345",
      files_changed: 3,
      description: "Implemented test feature",
      created_by: "test-agent",
    };

    const id = await registry.register(input);

    assertExists(id);
    assertEquals(typeof id, "string");
    assertEquals(id.length, 36); // UUID length
  });

  it("should set default values for optional fields", async () => {
    const input: IRegisterReviewInput = {
      trace_id: crypto.randomUUID(),
      portal: "TestPortal",
      repository: "/test/repo",
      branch: "feat/minimal-test",
      description: "Minimal review",
      created_by: "test-agent",
      files_changed: 0,
    };

    const id = await registry.register(input);
    const review = await registry.get(id);

    assertExists(review);
    assertEquals(review.status, ReviewStatus.PENDING);
    assertEquals(review.files_changed, 0);
    assertEquals(review.commit_sha, null); // SQLite returns null for NULL values
  });

  it("should log review.created to IActivity Journal with a real, field-level payload", async () => {
    const trace_id = crypto.randomUUID();
    const input: IRegisterReviewInput = {
      trace_id,
      portal: "TestPortal",
      repository: "/test/repo",
      branch: "feat/logging-test",
      description: "Test logging",
      created_by: "test-agent",
      files_changed: 1,
    };

    const id = await registry.register(input);
    await db.waitForFlush();

    const activities = db.getActivitiesByTrace(trace_id);
    const created = activities.find((a) => a.action_type === "review.created");

    assertExists(created);
    assertEquals(created.target, "feat/logging-test");
    const payload = JSON.parse(created.payload ?? "{}");
    assertEquals(payload.review_id, id);
    assertEquals(payload.trace_id, trace_id);
    assertEquals(payload.branch, "feat/logging-test");
    assertEquals(payload.repository, "/test/repo");
  });

  it("should reject invalid input", async () => {
    const input = {
      trace_id: "invalid-uuid",
      portal: "TestPortal",
      branch: "feat/test",
      description: "Test",
      created_by: MemoryBankSource.USER,
      files_changed: 0,
    };

    await assertRejects(
      async () => await registry.register(input as IRegisterReviewInput),
      Error,
    );
  });

  // Retrieval Tests

  it("should get review by ID", async () => {
    const input: IRegisterReviewInput = {
      trace_id: crypto.randomUUID(),
      portal: "TestPortal",
      repository: "/test/repo",
      branch: "feat/get-test",
      description: "Test retrieval",
      created_by: "test-agent",
      files_changed: 2,
    };

    const id = await registry.register(input);
    const review = await registry.get(id);

    assertExists(review);
    assertEquals(review.id, id);
    assertEquals(review.portal, "TestPortal");
    assertEquals(review.branch, "feat/get-test");
    assertEquals(review.description, "Test retrieval");
    assertEquals(review.created_by, "test-agent");
    assertEquals(review.files_changed, 2);
  });

  it("should return null for non-existent review", async () => {
    const review = await registry.get(crypto.randomUUID());
    assertEquals(review, null);
  });

  it("should log review.read (by-id) to IActivity Journal", async () => {
    const trace_id = crypto.randomUUID();
    const input: IRegisterReviewInput = {
      trace_id,
      portal: "TestPortal",
      repository: "/test/repo",
      branch: "feat/read-by-id-logging",
      description: "Test read-by-id logging",
      created_by: "test-agent",
      files_changed: 1,
    };

    const id = await registry.register(input);
    await registry.get(id);
    await db.waitForFlush();

    const activities = db.getActivitiesByTrace(trace_id);
    const read = activities.find((a) => a.action_type === "review.read");

    assertExists(read);
    const payload = JSON.parse(read.payload);
    assertEquals(payload.lookup, "by-id");
    assertEquals(payload.trace_id, trace_id);
  });

  it("should get review by branch name", async () => {
    const input: IRegisterReviewInput = {
      trace_id: crypto.randomUUID(),
      portal: "TestPortal",
      repository: "/test/repo",
      branch: "feat/branch-lookup",
      description: "Test branch lookup",
      created_by: "test-agent",
      files_changed: 1,
    };

    await registry.register(input);
    const review = await registry.getByBranch("feat/branch-lookup");

    assertExists(review);
    assertEquals(review.branch, "feat/branch-lookup");
  });

  it("should log review.read (by-branch) to IActivity Journal", async () => {
    const trace_id = crypto.randomUUID();
    const input: IRegisterReviewInput = {
      trace_id,
      portal: "TestPortal",
      repository: "/test/repo",
      branch: "feat/branch-lookup-logging",
      description: "Test branch lookup logging",
      created_by: "test-agent",
      files_changed: 1,
    };

    await registry.register(input);
    await registry.getByBranch("feat/branch-lookup-logging");
    await db.waitForFlush();

    const activities = db.getActivitiesByTrace(trace_id);
    const read = activities.find((a) => a.action_type === "review.read");

    assertExists(read);
    const payload = JSON.parse(read.payload);
    assertEquals(payload.lookup, "by-branch");
    assertEquals(payload.trace_id, trace_id);
  });

  // Listing Tests

  it("should list all reviews", async () => {
    const trace_id = crypto.randomUUID();

    await registry.register({
      trace_id,
      repository: "/test/repo",
      portal: "Portal1",
      branch: "feat/test-1",
      description: "Test 1",
      created_by: "agent-1",
      files_changed: 1,
    });

    await registry.register({
      trace_id,
      repository: "/test/repo",
      portal: "Portal2",
      branch: "feat/test-2",
      description: "Test 2",
      created_by: "agent-2",
      files_changed: 2,
    });

    const reviews = await registry.list();

    assertEquals(reviews.length, 2);
  });

  it("should log review.list.read to IActivity Journal", async () => {
    const trace_id = crypto.randomUUID();

    await registry.register({
      trace_id,
      repository: "/test/repo",
      portal: "TestPortal",
      branch: "feat/list-logging",
      description: "List logging test",
      created_by: "test-agent",
      files_changed: 1,
    });

    await registry.list({ trace_id, portal: "TestPortal" });
    await db.waitForFlush();

    const activities = db.getActivitiesByTrace(trace_id);
    const listRead = activities.find((a) => a.action_type === "review.list.read");

    assertExists(listRead);
    const payload = JSON.parse(listRead.payload);
    assertEquals(payload.filters.trace_id, trace_id);
    assertEquals(payload.filters.portal, "TestPortal");
    assertEquals(payload.result_count, 1);
  });

  it("should filter reviews by trace_id", async () => {
    const trace_id1 = crypto.randomUUID();
    const trace_id2 = crypto.randomUUID();

    await registry.register({
      trace_id: trace_id1,
      repository: "/test/repo",
      portal: "TestPortal",
      branch: "feat/trace-1",
      description: "Trace 1",
      created_by: MemoryBankSource.USER,
      files_changed: 1,
    });

    await registry.register({
      trace_id: trace_id2,
      repository: "/test/repo",
      portal: "TestPortal",
      branch: "feat/trace-2",
      description: "Trace 2",
      created_by: MemoryBankSource.USER,
      files_changed: 1,
    });

    const reviews = await registry.list({ trace_id: trace_id1 });

    assertEquals(reviews.length, 1);
    assertEquals(reviews[0].trace_id, trace_id1);
  });

  it("should filter reviews by portal", async () => {
    const trace_id = crypto.randomUUID();

    await registry.register({
      trace_id,
      repository: "/test/repo",
      portal: "Portal1",
      branch: "feat/portal-1",
      description: "Portal 1",
      created_by: MemoryBankSource.USER,
      files_changed: 1,
    });

    await registry.register({
      trace_id,
      repository: "/test/repo",
      portal: "Portal2",
      branch: "feat/portal-2",
      description: "Portal 2",
      created_by: MemoryBankSource.USER,
      files_changed: 1,
    });

    const reviews = await registry.list({ portal: "Portal1" });

    assertEquals(reviews.length, 1);
    assertEquals(reviews[0].portal, "Portal1");
  });

  it("should filter reviews by status", async () => {
    const trace_id = crypto.randomUUID();

    const id1 = await registry.register({
      trace_id,
      repository: "/test/repo",
      portal: "TestPortal",
      branch: "feat/status-pending",
      description: "Pending",
      created_by: MemoryBankSource.USER,
      files_changed: 1,
    });

    const id2 = await registry.register({
      trace_id,
      repository: "/test/repo",
      portal: "TestPortal",
      branch: "feat/status-approved",
      description: "Approved",
      created_by: MemoryBankSource.USER,
      files_changed: 1,
    });

    await registry.updateStatus(id2, ReviewStatus.APPROVED, "test-user");

    const pending = await registry.list({ status: ReviewStatus.PENDING });
    const approved = await registry.list({ status: ReviewStatus.APPROVED });

    assertEquals(pending.length, 1);
    assertEquals(pending[0].id, id1);
    assertEquals(approved.length, 1);
    assertEquals(approved[0].id, id2);
  });

  it("should filter reviews by created_by", async () => {
    const trace_id = crypto.randomUUID();

    await registry.register({
      trace_id,
      repository: "/test/repo",
      portal: "TestPortal",
      branch: "feat/agent-1",
      description: "Agent 1",
      created_by: "agent-1",
      files_changed: 1,
    });

    await registry.register({
      trace_id,
      repository: "/test/repo",
      portal: "TestPortal",
      branch: "feat/agent-2",
      description: "Agent 2",
      created_by: "agent-2",
      files_changed: 1,
    });

    const reviews = await registry.list({ created_by: "agent-1" });

    assertEquals(reviews.length, 1);
    assertEquals(reviews[0].created_by, "agent-1");
  });

  // Status Update Tests

  it("should update review to approved status", async () => {
    const input: IRegisterReviewInput = {
      trace_id: crypto.randomUUID(),
      portal: "TestPortal",
      repository: "/test/repo",
      branch: "feat/approve-test",
      description: "Test approval",
      created_by: "test-agent",
      files_changed: 1,
    };

    const id = await registry.register(input);
    await registry.updateStatus(id, ReviewStatus.APPROVED, "test-user");

    const review = await registry.get(id);

    assertExists(review);
    assertEquals(review.status, ReviewStatus.APPROVED);
    assertEquals(review.approved_by, "test-user");
    assertExists(review.approved_at);
  });

  it("should update review to rejected status", async () => {
    const input: IRegisterReviewInput = {
      trace_id: crypto.randomUUID(),
      portal: "TestPortal",
      repository: "/test/repo",
      branch: "feat/reject-test",
      description: "Test rejection",
      created_by: "test-agent",
      files_changed: 1,
    };

    const id = await registry.register(input);
    await registry.updateStatus(id, ReviewStatus.REJECTED, "test-user", "Not meeting requirements");

    const review = await registry.get(id);

    assertExists(review);
    assertEquals(review.status, ReviewStatus.REJECTED);
    assertEquals(review.rejected_by, "test-user");
    assertEquals(review.rejection_reason, "Not meeting requirements");
    assertExists(review.rejected_at);
  });

  it("should log review.approved to IActivity Journal with a real, field-level payload", async () => {
    const trace_id = crypto.randomUUID();
    const input: IRegisterReviewInput = {
      trace_id,
      portal: "TestPortal",
      repository: "/test/repo",
      branch: "feat/approve-logging",
      description: "Test approval logging",
      created_by: "test-agent",
      files_changed: 1,
    };

    const id = await registry.register(input);
    await registry.updateStatus(id, ReviewStatus.APPROVED, "test-user");
    await db.waitForFlush();

    const activities = db.getActivitiesByTrace(trace_id);
    const approved = activities.find((a) => a.action_type === "review.approved");

    assertExists(approved);
    assertEquals(approved.target, "feat/approve-logging");
    const payload = JSON.parse(approved.payload ?? "{}");
    assertEquals(payload.review_id, id);
    assertEquals(payload.trace_id, trace_id);
    assertEquals(payload.branch, "feat/approve-logging");
    assertEquals(payload.approved_by, "test-user");
    assertExists(payload.approved_at);
  });

  it("should log review.rejected to IActivity Journal with a real, field-level payload", async () => {
    const trace_id = crypto.randomUUID();
    const input: IRegisterReviewInput = {
      trace_id,
      portal: "TestPortal",
      repository: "/test/repo",
      branch: "feat/reject-logging",
      description: "Test rejection logging",
      created_by: "test-agent",
      files_changed: 1,
    };

    const id = await registry.register(input);
    await registry.updateStatus(id, ReviewStatus.REJECTED, "test-user", "Invalid approach");
    await db.waitForFlush();

    const activities = db.getActivitiesByTrace(trace_id);
    const rejected = activities.find((a) => a.action_type === "review.rejected");

    assertExists(rejected);
    assertEquals(rejected.target, "feat/reject-logging");
    const payload = JSON.parse(rejected.payload ?? "{}");
    assertEquals(payload.review_id, id);
    assertEquals(payload.trace_id, trace_id);
    assertEquals(payload.branch, "feat/reject-logging");
    assertEquals(payload.rejected_by, "test-user");
    assertEquals(payload.rejection_reason, "Invalid approach");
    assertExists(payload.rejected_at);
  });

  it("should throw error when updating non-existent review", async () => {
    await assertRejects(
      async () => await registry.updateStatus(crypto.randomUUID(), ReviewStatus.APPROVED),
      Error,
      "Review not found",
    );
  });

  // Utility Method Tests

  it("should get all reviews for a trace", async () => {
    const trace_id = crypto.randomUUID();

    await registry.register({
      trace_id,
      repository: "/test/repo",
      portal: "TestPortal",
      branch: "feat/trace-1",
      description: "Test 1",
      created_by: MemoryBankSource.USER,
      files_changed: 1,
    });

    await registry.register({
      trace_id,
      repository: "/test/repo",
      portal: "TestPortal",
      branch: "feat/trace-2",
      description: "Test 2",
      created_by: MemoryBankSource.USER,
      files_changed: 2,
    });

    const reviews = await registry.getByTrace(trace_id);

    assertEquals(reviews.length, 2);
  });

  it("should get pending reviews for a portal", async () => {
    const trace_id = crypto.randomUUID();

    const id1 = await registry.register({
      trace_id,
      repository: "/test/repo",
      portal: "TestPortal",
      branch: "feat/pending-1",
      description: "Pending 1",
      created_by: MemoryBankSource.USER,
      files_changed: 1,
    });

    const id2 = await registry.register({
      trace_id,
      repository: "/test/repo",
      portal: "TestPortal",
      branch: "feat/pending-2",
      description: "Pending 2",
      created_by: MemoryBankSource.USER,
      files_changed: 1,
    });

    await registry.updateStatus(id2, ReviewStatus.APPROVED, MemoryBankSource.USER);

    const pending = await registry.getPendingForPortal("TestPortal");

    assertEquals(pending.length, 1);
    assertEquals(pending[0].id, id1);
  });

  it("should count reviews by status", async () => {
    const trace_id = crypto.randomUUID();

    const id1 = await registry.register({
      trace_id,
      repository: "/test/repo",
      portal: "TestPortal",
      branch: "feat/count-1",
      description: "Count 1",
      created_by: MemoryBankSource.USER,
      files_changed: 1,
    });

    await registry.register({
      trace_id,
      repository: "/test/repo",
      portal: "TestPortal",
      branch: "feat/count-2",
      description: "Count 2",
      created_by: MemoryBankSource.USER,
      files_changed: 1,
    });

    await registry.updateStatus(id1, ReviewStatus.APPROVED, MemoryBankSource.USER);

    const pendingCount = await registry.countByStatus(ReviewStatus.PENDING);
    const approvedCount = await registry.countByStatus(ReviewStatus.APPROVED);

    assertEquals(pendingCount, 1);
    assertEquals(approvedCount, 1);
  });

  it("should log review.count.read to IActivity Journal", async () => {
    const trace_id = crypto.randomUUID();

    await registry.register({
      trace_id,
      repository: "/test/repo",
      portal: "TestPortal",
      branch: "feat/count-logging",
      description: "Count logging test",
      created_by: "test-agent",
      files_changed: 1,
    });

    await db.waitForFlush();
    const beforeCount = db.getActivitiesByActionType("review.count.read").length;

    const count = await registry.countByStatus(ReviewStatus.PENDING);
    await db.waitForFlush();

    const activities = db.getActivitiesByActionType("review.count.read");
    assertEquals(activities.length, beforeCount + 1);

    const payload = JSON.parse(activities[activities.length - 1].payload);
    assertEquals(payload.status, ReviewStatus.PENDING);
    assertEquals(payload.count, count);
  });

  // Deletion Tests

  it("should delete a review", async () => {
    const trace_id = crypto.randomUUID();

    const id = await registry.register({
      trace_id,
      repository: "/test/repo",
      portal: "TestPortal",
      branch: "feat/delete-test",
      description: "Delete test",
      created_by: "test-agent",
      files_changed: 1,
    });

    await registry.delete(id);

    const review = await registry.get(id);
    assertEquals(review, null);
  });

  it("should log review.deleted to IActivity Journal", async () => {
    const trace_id = crypto.randomUUID();

    const id = await registry.register({
      trace_id,
      repository: "/test/repo",
      portal: "TestPortal",
      branch: "feat/delete-logging",
      description: "Delete logging test",
      created_by: "test-agent",
      files_changed: 1,
    });

    await db.waitForFlush();
    const beforeCount = db.getActivitiesByActionType("review.deleted").length;

    await registry.delete(id);
    await db.waitForFlush();

    const activities = db.getActivitiesByActionType("review.deleted");
    assertEquals(activities.length, beforeCount + 1);

    const deleted = activities[activities.length - 1];
    assertEquals(deleted.target, id);
    const payload = JSON.parse(deleted.payload);
    assertEquals(payload.review_id, id);
  });

  it("should persist review.diff.read through a real EventLogger", async () => {
    const repository = await Deno.makeTempDir({ prefix: "review-diff-event-" });
    const runGit = async (args: string[]): Promise<void> => {
      const result = await new Deno.Command("git", { args, cwd: repository, stdout: "piped", stderr: "piped" })
        .output();
      if (!result.success) throw new Error(new TextDecoder().decode(result.stderr));
    };

    try {
      await runGit(["init", "-b", "main"]);
      await runGit(["config", "user.name", "Test User"]);
      await runGit(["config", "user.email", "test@example.com"]);
      await Deno.writeTextFile(join(repository, "review.txt"), "before\n");
      await runGit(["add", "review.txt"]);
      await runGit(["commit", "-m", "initial"]);
      await runGit(["checkout", "-b", "feat/diff-event"]);
      await Deno.writeTextFile(join(repository, "review.txt"), "after\n");
      await runGit(["add", "review.txt"]);
      await runGit(["commit", "-m", "change"]);

      const traceId = crypto.randomUUID();
      const reviewId = await registry.register({
        trace_id: traceId,
        repository,
        portal: "TestPortal",
        branch: "feat/diff-event",
        base_branch: "main",
        description: "Diff event proof",
        created_by: "test-agent",
        files_changed: 1,
      });

      const diff = await registry.getDiff(reviewId);
      assertEquals(diff.includes("+after"), true);
      await db.waitForFlush();

      const rows = db.getActivitiesByTrace(traceId).filter(
        (activity) => activity.action_type === DomainEventType.ReviewDiffRead,
      );
      assertEquals(rows.length, 1, "review.diff.read must persist exactly once under the review trace");
      const payload = JSON.parse(rows[0].payload);
      assertEquals(payload.review_id, reviewId);
      assertEquals(payload.branch, "feat/diff-event");
      assertEquals(payload.base_branch, "main");
    } finally {
      await Deno.remove(repository, { recursive: true });
    }
  });
});
