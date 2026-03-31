/**
 * @module ReviewRegistryPortalTest
 * @path tests/services/review_registry_portal_test.ts
 * @description Verifies the ReviewRegistry's ability to discover and manage reviewable artifacts
 * across partitioned portal repositories, ensuring correct path mapping and state persistence.
 */

import { assertEquals } from "@std/assert";
import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { join } from "@std/path";
import { ReviewRegistry } from "../../../src/services/artifact/review_registry.ts";
import { GitService } from "../../../src/services/core/git_service.ts";
import { EventLogger } from "../../../src/services/core/event_logger.ts";
import { GitTestHelper } from "../../helpers/git_test_helper.ts";
import { setupPortalGitRepos } from "../../helpers/portal_test_utils.ts";
import type { Config } from "../../../src/shared/schemas/config.ts";

/**
 * TDD Tests for ReviewRegistry Portal Support
 * Task 3.2: Review Tracking Updates
 *
 * Tests that ReviewRegistry can track reviews in portal repositories
 * and associate them with portal workspaces
 */

describe("ReviewRegistry Portal Support", () => {
  let portalRepoDir: string;
  let workspaceRepoDir: string;
  let config: Config;
  let cleanup: () => Promise<void>;
  let registry: ReviewRegistry;
  let portalGitService: GitService;
  let workspaceGitService: GitService;
  let logger: EventLogger;

  beforeEach(async () => {
    const setup = await setupPortalGitRepos();
    portalRepoDir = setup.portalRepoDir;
    workspaceRepoDir = setup.workspaceRepoDir;
    config = setup.config;
    cleanup = setup.cleanup;
    logger = new EventLogger({ db: setup.db });
    registry = new ReviewRegistry(setup.db, logger);
    portalGitService = new GitService({ config, repoPath: portalRepoDir });
    workspaceGitService = new GitService({ config, repoPath: workspaceRepoDir });
  });

  afterEach(async () => {
    if (cleanup) {
      await cleanup();
    }
  });

  describe("createReview with repository path", () => {
    it("stores portal repository path in review", async () => {
      const traceId = crypto.randomUUID();
      const branchName = await portalGitService.createBranch({
        requestId: "test-request",
        traceId,
      });

      const reviewId = await registry.createReview(
        traceId,
        "test-portal",
        branchName,
        portalRepoDir,
      );

      const review = await registry.get(reviewId);
      assertEquals(review?.repository, portalRepoDir);
      assertEquals(review?.portal, "test-portal");
    });

    it("stores workspace repository path for workspace reviews", async () => {
      const traceId = crypto.randomUUID();
      const branchName = await workspaceGitService.createBranch({
        requestId: "workspace-req",
        traceId,
      });

      const reviewId = await registry.createReview(
        traceId,
        null, // No portal for workspace review
        branchName,
        workspaceRepoDir,
      );

      const review = await registry.get(reviewId);
      assertEquals(review?.repository, workspaceRepoDir);
      assertEquals(review?.portal, null);
    });

    it("creates branch in specified repository", async () => {
      const traceId = crypto.randomUUID();

      const branchName = await portalGitService.createBranch({
        requestId: "portal-req",
        traceId,
      });

      await registry.createReview(
        traceId,
        "test-portal",
        branchName,
        portalRepoDir,
      );

      const portalBranches = await new GitTestHelper(portalRepoDir).listBranches();
      assertEquals(portalBranches.includes(branchName), true);

      const workspaceBranches = await new GitTestHelper(workspaceRepoDir).listBranches();
      assertEquals(workspaceBranches.includes(branchName), false);
    });
  });

  describe("getDiff from portal repository", () => {
    it("retrieves diff from portal repository", async () => {
      const traceId = crypto.randomUUID();

      const branchName = await portalGitService.createBranch({
        requestId: "diff-test",
        traceId,
      });

      const reviewId = await registry.createReview(
        traceId,
        "test-portal",
        branchName,
        portalRepoDir,
      );

      await Deno.writeTextFile(join(portalRepoDir, "test.txt"), "portal content");
      await portalGitService.runGitCommand(["add", "."]);
      await portalGitService.commit({
        message: "Test commit",
        traceId,
      });

      const diff = await registry.getDiff(reviewId);

      assertEquals(diff.includes("portal content"), true);
      assertEquals(diff.includes("test.txt"), true);
    });

    it("diff from portal repo is isolated from workspace repo", async () => {
      const portalTraceId = crypto.randomUUID();
      const workspaceTraceId = crypto.randomUUID();

      const portalBranch = await portalGitService.createBranch({
        requestId: "portal-diff",
        traceId: portalTraceId,
      });

      const workspaceBranch = await workspaceGitService.createBranch({
        requestId: "workspace-diff",
        traceId: workspaceTraceId,
      });

      const portalReviewId = await registry.createReview(
        portalTraceId,
        "test-portal",
        portalBranch,
        portalRepoDir,
      );

      const workspaceReviewId = await registry.createReview(
        workspaceTraceId,
        null,
        workspaceBranch,
        workspaceRepoDir,
      );

      await Deno.writeTextFile(join(portalRepoDir, "portal.txt"), "portal only");
      await portalGitService.runGitCommand(["add", "."]);
      await portalGitService.commit({
        message: "Portal change",
        traceId: portalTraceId,
      });

      await Deno.writeTextFile(join(workspaceRepoDir, "workspace.txt"), "workspace only");
      await workspaceGitService.runGitCommand(["add", "."]);
      await workspaceGitService.commit({
        message: "Workspace change",
        traceId: workspaceTraceId,
      });

      const portalDiff = await registry.getDiff(portalReviewId);
      const workspaceDiff = await registry.getDiff(workspaceReviewId);

      assertEquals(portalDiff.includes("portal.txt"), true);
      assertEquals(portalDiff.includes("workspace.txt"), false);

      assertEquals(workspaceDiff.includes("workspace.txt"), true);
      assertEquals(workspaceDiff.includes("portal.txt"), false);
    });
  });

  describe("review listing by repository", () => {
    it("lists reviews from specific portal", async () => {
      const trace1 = crypto.randomUUID();
      const trace2 = crypto.randomUUID();
      const trace3 = crypto.randomUUID();
      // Create reviews in different repos
      const portalBranch1 = await portalGitService.createBranch({
        requestId: "portal1",
        traceId: trace1,
      });
      const portalBranch2 = await portalGitService.createBranch({
        requestId: "portal2",
        traceId: trace2,
      });
      const workspaceBranch = await workspaceGitService.createBranch({
        requestId: "workspace",
        traceId: trace3,
      });

      await registry.createReview(trace1, "test-portal", portalBranch1, portalRepoDir);
      await registry.createReview(trace2, "test-portal", portalBranch2, portalRepoDir);
      await registry.createReview(trace3, null, workspaceBranch, workspaceRepoDir);

      // List reviews for portal
      const portalReviews = await registry.list({ portal: "test-portal" });
      assertEquals(portalReviews.length, 2);
      assertEquals(portalReviews.every((cs) => cs.portal === "test-portal"), true);
      assertEquals(portalReviews.every((cs) => cs.repository === portalRepoDir), true);
    });

    it("lists workspace reviews separately", async () => {
      const portalTraceId = crypto.randomUUID();
      const workspaceTraceId = crypto.randomUUID();
      const portalBranch = await portalGitService.createBranch({
        requestId: "portal",
        traceId: portalTraceId,
      });
      const workspaceBranch = await workspaceGitService.createBranch({
        requestId: "workspace",
        traceId: workspaceTraceId,
      });

      await registry.createReview(portalTraceId, "test-portal", portalBranch, portalRepoDir);
      await registry.createReview(workspaceTraceId, null, workspaceBranch, workspaceRepoDir);

      // List all reviews
      const allReviews = await registry.list();
      const workspaceReviews = allReviews.filter((cs) => cs.portal === null);

      assertEquals(workspaceReviews.length, 1);
      assertEquals(workspaceReviews[0].repository, workspaceRepoDir);
    });
  });
});
