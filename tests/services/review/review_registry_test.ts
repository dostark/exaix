/**
 * @module ReviewRegistryTest
 * @path tests/services/review/review_registry_test.ts
 * @description Verifies the core ReviewRegistry service, ensuring stable registration and lifecycle
 * tracking for agent execution plans awaiting human or automated review.
 */

import { assertEquals, assertExists, assertRejects } from "@std/assert";
import { MemoryBankSource } from "@exaix/core";
import { ReviewStatus } from "../../../src/reviews/review_status.ts";

import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { ReviewRegistry } from "../../../src/services/artifact/review_registry.ts";
import { EventLogger } from "../../../src/services/core/event_logger.ts";
import { initTestDbService } from "../../helpers/db.ts";
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

  // ============================================================================
  // Registration Tests
  // ============================================================================

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

  it("should log review.created to IActivity Journal", async () => {
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

    await registry.register(input);
    await db.waitForFlush();

    const activities = db.getActivitiesByTrace(trace_id);
    const created = activities.find((a) => a.action_type === "review.created");

    assertExists(created);
    assertEquals(created.target, "feat/logging-test");
  });

  it("should reject invalid input", async () => {
    const input = {
      trace_id: "invalid-uuid",
      portal: "TestPortal",
      branch: "feat/test",
      description: "Test",
      created_by: MemoryBankSource.IDENTITY,
      files_changed: 0,
    };

    await assertRejects(
      async () => await registry.register(input as IRegisterReviewInput),
      Error,
    );
  });

  // ============================================================================
  // Retrieval Tests
  // ============================================================================

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

  // ============================================================================
  // Listing Tests
  // ============================================================================

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

  it("should filter reviews by trace_id", async () => {
    const trace_id1 = crypto.randomUUID();
    const trace_id2 = crypto.randomUUID();

    await registry.register({
      trace_id: trace_id1,
      repository: "/test/repo",
      portal: "TestPortal",
      branch: "feat/trace-1",
      description: "Trace 1",
      created_by: MemoryBankSource.IDENTITY,
      files_changed: 1,
    });

    await registry.register({
      trace_id: trace_id2,
      repository: "/test/repo",
      portal: "TestPortal",
      branch: "feat/trace-2",
      description: "Trace 2",
      created_by: MemoryBankSource.IDENTITY,
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
      created_by: MemoryBankSource.IDENTITY,
      files_changed: 1,
    });

    await registry.register({
      trace_id,
      repository: "/test/repo",
      portal: "Portal2",
      branch: "feat/portal-2",
      description: "Portal 2",
      created_by: MemoryBankSource.IDENTITY,
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
      created_by: MemoryBankSource.IDENTITY,
      files_changed: 1,
    });

    const id2 = await registry.register({
      trace_id,
      repository: "/test/repo",
      portal: "TestPortal",
      branch: "feat/status-approved",
      description: "Approved",
      created_by: MemoryBankSource.IDENTITY,
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

  // ============================================================================
  // Status Update Tests
  // ============================================================================

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

  it("should log review.approved to IActivity Journal", async () => {
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
  });

  it("should log review.rejected to IActivity Journal", async () => {
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
  });

  it("should throw error when updating non-existent review", async () => {
    await assertRejects(
      async () => await registry.updateStatus(crypto.randomUUID(), ReviewStatus.APPROVED),
      Error,
      "Review not found",
    );
  });

  // ============================================================================
  // Utility Method Tests
  // ============================================================================

  it("should get all reviews for a trace", async () => {
    const trace_id = crypto.randomUUID();

    await registry.register({
      trace_id,
      repository: "/test/repo",
      portal: "TestPortal",
      branch: "feat/trace-1",
      description: "Test 1",
      created_by: MemoryBankSource.IDENTITY,
      files_changed: 1,
    });

    await registry.register({
      trace_id,
      repository: "/test/repo",
      portal: "TestPortal",
      branch: "feat/trace-2",
      description: "Test 2",
      created_by: MemoryBankSource.IDENTITY,
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
      created_by: MemoryBankSource.IDENTITY,
      files_changed: 1,
    });

    const id2 = await registry.register({
      trace_id,
      repository: "/test/repo",
      portal: "TestPortal",
      branch: "feat/pending-2",
      description: "Pending 2",
      created_by: MemoryBankSource.IDENTITY,
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
      created_by: MemoryBankSource.IDENTITY,
      files_changed: 1,
    });

    await registry.register({
      trace_id,
      repository: "/test/repo",
      portal: "TestPortal",
      branch: "feat/count-2",
      description: "Count 2",
      created_by: MemoryBankSource.IDENTITY,
      files_changed: 1,
    });

    await registry.updateStatus(id1, ReviewStatus.APPROVED, MemoryBankSource.USER);

    const pendingCount = await registry.countByStatus(ReviewStatus.PENDING);
    const approvedCount = await registry.countByStatus(ReviewStatus.APPROVED);

    assertEquals(pendingCount, 1);
    assertEquals(approvedCount, 1);
  });
});
