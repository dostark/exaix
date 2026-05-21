/**
 * @module ReviewCommandsTest
 * @path tests/cli/review_commands_test.ts
 * @description Verifies CLI review operations for execution artifacts, including status listing,
 * detailed review viewing, and approval/rejection of code branches and artifacts.
 */

import { assertEquals, assertExists, assertRejects, assertStringIncludes } from "@std/assert";
import { FlowStepType, MemoryOperation } from "@exaix/core";
import { ReviewStatus } from "@exaix/core/status";

import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { join } from "@std/path";
import { ReviewCommands } from "../../src/cli/commands/review_commands.ts";
import type { DatabaseService as DatabaseService } from "@exaix/storage-sqlite";
import { ArtifactRegistry } from "@exaix/core/artifact";
import { createCliTestContext, initGitRepo, runGitCommand } from "./helpers/test_setup.ts";
import { createStubConfig, createStubDisplay, createStubGit, createStubProvider } from "../helpers/test_helpers.ts";
import type { ICliApplicationContext } from "../../src/cli/cli_context.ts";
import type { Config } from "@exaix/schemas/config.ts";
import { TEST_DEFAULT_BRANCH } from "@exaix/git/testing";

describe("ReviewCommands", () => {
  let tempDir: string;
  let db: DatabaseService;
  let reviewCommands: ReviewCommands;
  let config: Config;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    // Initialize shared CLI test context
    const result = await createCliTestContext();
    tempDir = result.tempDir;
    db = result.db;
    config = result.config;
    cleanup = result.cleanup;

    // Initialize git repository
    await initGitRepo(tempDir);

    reviewCommands = new ReviewCommands(result.context);
  });

  afterEach(async () => {
    await cleanup();
  });

  describe("list", () => {
    it("should return empty array when no reviews exist", async () => {
      const reviews = await reviewCommands.list();
      assertEquals(reviews, []);
    });

    it("should find feat/* branches", async () => {
      // Create a feature branch with proper naming
      await createFeatureBranch(tempDir, "request-001", "abc-123-def");

      const reviews = await reviewCommands.list();
      assertEquals(reviews.length, 1);
      assertEquals(reviews[0].branch, "feat/request-001-abc-123-def");
    });

    it("should extract trace_id from branch name", async () => {
      await createFeatureBranch(tempDir, "request-002", "def-456-abc");

      const reviews = await reviewCommands.list();
      assertEquals(reviews[0].trace_id, "def-456-abc");
      assertEquals(reviews[0].request_id, "request-002");
    });

    it("should filter by status", async () => {
      await createFeatureBranch(tempDir, "request-003", "abc-789-def");

      // Log an approval in activity log
      await db.logActivity(
        "human",
        "review.approved",
        "request-003",
        { approved_by: "test@example.com" },
        "abc-789-def",
        null,
      );
      // Wait for batched write to complete
      await db.waitForFlush();

      // Filter for approved
      const approved = await reviewCommands.list(ReviewStatus.APPROVED);
      assertEquals(approved.length, 1);

      // Filter for pending
      const pending = await reviewCommands.list(ReviewStatus.PENDING);
      assertEquals(pending.length, 0);
    });

    it("should sort by creation date descending", async () => {
      // Create multiple branches with delays
      await createFeatureBranch(tempDir, "request-001", "aaa-111-bbb");
      // Git commit timestamps are second-precision, need real delay
      await delay(1500);
      await createFeatureBranch(tempDir, "request-002", "bbb-222-ccc");

      const reviews = await reviewCommands.list();
      assertEquals(reviews.length, 2);
      // Most recent should be first
      assertEquals(reviews[0].request_id, "request-002");
      assertEquals(reviews[1].request_id, "request-001");
    });

    it("should count files changed", async () => {
      await createFeatureBranch(tempDir, "request-004", "ccc-333-ddd", 2);

      const reviews = await reviewCommands.list();
      assertEquals(reviews[0].files_changed, 2);
    });

    it("should scan config.portals for reviews", async () => {
      // Create a separate git repo to simulate a portal
      const portalDir = await Deno.makeTempDir({ prefix: "portal-repo-" });
      try {
        // Initialize git repo in portal directory
        await initGitRepo(portalDir); // Uses shared helper

        // Create a feature branch in the portal repo
        await createFeatureBranch(portalDir, "request-006", "portal-456-ghi");

        // Create a config with the portal defined
        const portalConfig = {
          ...config,
          portals: [{
            alias: "test-portal",
            target_path: portalDir,
            default_branch: TEST_DEFAULT_BRANCH,
            identities_allowed: ["*"],
            operations: [],
            created: new Date().toISOString(),
          }],
        };

        const portalContext: ICliApplicationContext = {
          config: createStubConfig(portalConfig),
          db,
          git: createStubGit(),
          provider: createStubProvider(),
          display: createStubDisplay(),
        };

        // Create review commands with the portal config
        const portalReviewCommands = new ReviewCommands(portalContext);

        // Should find the review in the portal repo
        const reviews = await portalReviewCommands.list();
        assertEquals(reviews.length, 1);
        assertEquals(reviews[0].branch, "feat/request-006-portal-456-ghi");
        assertEquals(reviews[0].request_id, "request-006");
        assertEquals(reviews[0].trace_id, "portal-456-ghi");
      } finally {
        await Deno.remove(portalDir, { recursive: true });
      }
    });

    it("should include artifact-backed reviews by default", async () => {
      const artifactRegistry = new ArtifactRegistry(db, config.system.root);
      const artifactId = await artifactRegistry.createArtifact(
        "request-artifact-001",
        "code-analyst",
        "# Artifact body\n\nHello from artifact",
      );

      const reviews = await reviewCommands.list();
      assertEquals(reviews.length, 1);
      assertEquals(reviews[0].type, "artifact");
      assertEquals(reviews[0].branch, artifactId);
      assertEquals(reviews[0].request_id, "request-artifact-001");
      assertEquals(reviews[0].status, ReviewStatus.PENDING);
    });

    it("should support type filtering (code vs artifact)", async () => {
      // Create a code review (feat/* branch)
      await createFeatureBranch(tempDir, "request-ty-001", "ty-001");

      // Create an artifact review
      const artifactRegistry = new ArtifactRegistry(db, config.system.root);
      await artifactRegistry.createArtifact(
        "request-ty-002",
        "code-analyst",
        "# Artifact\n\nOnly artifact",
      );

      const artifactsOnly = await reviewCommands.list(undefined, "artifact");
      assertEquals(artifactsOnly.length, 1);
      assertEquals(artifactsOnly[0].type, "artifact");

      const codeOnly = await reviewCommands.list(undefined, "code");
      assertEquals(codeOnly.length, 1);
      assertEquals(codeOnly[0].type, "code");
      assertStringIncludes(codeOnly[0].branch, "feat/request-ty-001-");
    });

    it("should merge and sort code + artifacts by created_at", async () => {
      const artifactRegistry = new ArtifactRegistry(db, config.system.root);
      await artifactRegistry.createArtifact(
        "request-mixed001",
        "code-analyst",
        "# Early artifact\n\nFirst",
      );
      await db.waitForFlush();

      // Ensure git commit timestamp is later (git timestamps are second precision)
      await delay(1500);
      await createFeatureBranch(tempDir, "request-mixed002", "mixed-002");

      const reviews = await reviewCommands.list();
      assertEquals(reviews.length, 2);

      // Most recent entry first (the git review created after the delay)
      assertEquals(reviews[0].type, "code");
      assertEquals(reviews[0].request_id, "request-mixed002");
      assertEquals(reviews[1].type, "artifact");
      assertEquals(reviews[1].request_id, "request-mixed001");
    });

    it("should filter by status across both code reviews and artifacts", async () => {
      // Create a code review (pending by default)
      await createFeatureBranch(tempDir, "request-901", "st-001");

      // Create an artifact (pending by default)
      const artifactRegistry = new ArtifactRegistry(db, config.system.root);
      const artifactId = await artifactRegistry.createArtifact(
        "request-st-002",
        "code-analyst",
        "# Pending Artifact\n\nPending artifact",
      );

      const pending = await reviewCommands.list(ReviewStatus.PENDING, "all");
      assertEquals(pending.length, 2);
      assertEquals(pending.some((r) => r.type === "code"), true);
      assertEquals(pending.some((r) => r.type === "artifact"), true);

      // Approve both
      await reviewCommands.approve("request-901");
      await db.waitForFlush();
      await reviewCommands.approve(artifactId);

      const approved = await reviewCommands.list(ReviewStatus.APPROVED, "all");
      assertEquals(approved.length, 2);
      assertEquals(approved.every((r) => r.status === ReviewStatus.APPROVED), true);

      const rejected = await reviewCommands.list(ReviewStatus.REJECTED, "all");
      assertEquals(rejected.length, 0);
    });

    it("should sort merged list by created_at descending across types", async () => {
      // Create a code review first
      await createFeatureBranch(tempDir, "request-902", "sort-001");

      // Ensure artifact has a later timestamp
      await delay(1100);
      const artifactRegistry = new ArtifactRegistry(db, config.system.root);
      await artifactRegistry.createArtifact(
        "request-sort-002",
        "code-analyst",
        "# Newer Artifact\n\nNewer artifact",
      );

      const all = await reviewCommands.list(undefined, "all");
      assertEquals(all.length, 2);
      assertEquals(all[0].request_id, "request-sort-002");
      assertEquals(all[0].type, "artifact");
      assertEquals(all[1].request_id, "request-902");
      assertEquals(all[1].type, "code");
    });

    it("artifact list entries should expose file_path", async () => {
      const artifactRegistry = new ArtifactRegistry(db, config.system.root);
      const artifactId = await artifactRegistry.createArtifact(
        "request-filepath-001",
        "code-analyst",
        "# Artifact\n\nFile path test",
      );

      const all = await reviewCommands.list(undefined, "artifact");
      const entry = all.find((r) => r.branch === artifactId);
      assertExists(entry);
      if (!entry) throw new Error("Artifact entry not found");
      assertEquals(entry.type, "artifact");
      assertExists(entry.file_path);
      assertStringIncludes(entry.file_path!, "Memory/Execution/");
    });
  });

  describe("show", () => {
    it("should display review details", async () => {
      await createFeatureBranch(tempDir, "request-005", "abc-345-fed");

      const details = await reviewCommands.show("feat/request-005-abc-345-fed");

      assertExists(details);
      assertEquals(details.branch, "feat/request-005-abc-345-fed");
      assertEquals(details.trace_id, "abc-345-fed");
      assertEquals(details.request_id, "request-005");
      assertExists(details.diff);
      assertExists(details.commits);
      assertEquals(details.commits.length, 1);
    });

    it("should accept request_id as shorthand", async () => {
      await createFeatureBranch(tempDir, "request-006", "def-678-abc");

      const details = await reviewCommands.show("request-006");
      assertEquals(details.branch, "feat/request-006-def-678-abc");
    });

    it("should throw error for non-existent review", async () => {
      await assertRejects(
        async () => await reviewCommands.show("non-existent"),
        Error,
        "Review not found",
      );
    });

    it("should include commit history", async () => {
      await createFeatureBranch(tempDir, "request-007", "abc-901-def");

      const details = await reviewCommands.show("request-007");
      assertEquals(details.commits.length, 1);
      assertExists(details.commits[0].sha);
      assertExists(details.commits[0].message);
      assertStringIncludes(details.commits[0].message, "Add feature");
    });

    it("should generate unified diff", async () => {
      await createFeatureBranch(tempDir, "request-008", "def-234-abc");

      const details = await reviewCommands.show("request-008");
      assertStringIncludes(details.diff, "diff --git");
      assertStringIncludes(details.diff, "feature content");
    });

    it("should show artifact content for artifact IDs", async () => {
      const artifactRegistry = new ArtifactRegistry(db, config.system.root);
      const artifactId = await artifactRegistry.createArtifact(
        "request-artifact-002",
        "code-analyst",
        "# Artifact Title\n\nArtifact body content",
      );

      const details = await reviewCommands.show(artifactId);
      assertEquals(details.type, "artifact");
      assertEquals(details.branch, artifactId);
      assertEquals(details.request_id, "request-artifact-002");
      assertStringIncludes(details.diff, "Artifact body content");
      assertEquals(details.commits.length, 0);
    });
  });

  describe("approve", () => {
    it("should merge branch to main", async () => {
      await createFeatureBranch(tempDir, "request-009", "abc-567-fed");

      await reviewCommands.approve("request-009");

      // Verify branch was merged
      const log = await runGitCommand(tempDir, ["log", "--oneline"]);
      assertEquals(log.includes("Merge request-009"), true);
    });

    it(`should validate current branch is ${TEST_DEFAULT_BRANCH}`, async () => {
      await createFeatureBranch(tempDir, "request-010", "def-890-abc");

      // Switch to a different branch
      await runGitCommand(tempDir, ["checkout", "-b", "other-branch"]);

      await assertRejects(
        async () => await reviewCommands.approve("request-010"),
        Error,
        `Must be on '${TEST_DEFAULT_BRANCH}' branch`,
      );
    });

    it("should use --no-ff merge", async () => {
      await createFeatureBranch(tempDir, "request-011", "abc-123-fed");

      await reviewCommands.approve("request-011");

      // Check that a merge commit was created
      const log = await runGitCommand(tempDir, ["log", "--oneline", "-n", "1"]);
      assertStringIncludes(log, "Merge");
    });

    it("should log commit SHA to activity", async () => {
      await createFeatureBranch(tempDir, "request-012", "def-456-abc");

      await reviewCommands.approve("request-012");
      // Wait for batched write to complete
      await db.waitForFlush();

      // Check activity log
      const activities = await db.getActivitiesByTraceSafe("def-456-abc");
      const approval = activities.find((a: { action_type: string }) => a.action_type === "review.approved");

      assertExists(approval);
      assertExists(approval.payload);
      const payload = JSON.parse(approval.payload);
      assertExists(payload.commit_sha);
      // User identity is now in actor field, not approved_by
      assertExists(approval.actor);
    });

    it("should mark artifact as approved (no git)", async () => {
      const artifactRegistry = new ArtifactRegistry(db, config.system.root);
      const artifactId = await artifactRegistry.createArtifact(
        "request-artifact-003",
        "code-analyst",
        "# Approve Me\n\nThis is an artifact",
      );

      await reviewCommands.approve(artifactId);

      const updated = await artifactRegistry.getArtifact(artifactId);
      assertEquals(updated.status, ReviewStatus.APPROVED);
      const fileContent = await Deno.readTextFile(join(config.system.root, updated.file_path));
      assertStringIncludes(fileContent, `status: ${ReviewStatus.APPROVED}`);
    });
  });

  describe("reject", () => {
    it("should require rejection reason", async () => {
      await createFeatureBranch(tempDir, "request-013", "abc-789-fed");

      await assertRejects(
        async () => await reviewCommands.reject("request-013", ""),
        Error,
        "Rejection reason is required",
      );
    });

    it("should delete branch", async () => {
      await createFeatureBranch(tempDir, "request-014", "def-012-abc");

      await reviewCommands.reject("request-014", "Not needed");

      // Verify branch was deleted
      const branches = await runGitCommand(tempDir, [FlowStepType.BRANCH, "--list", "feat/*"]);
      assertEquals(branches.includes("feat/request-014-def-012-abc"), false);
    });

    it("should log rejection to activity", async () => {
      await createFeatureBranch(tempDir, "request-015", "abc-345-edf");

      await reviewCommands.reject("request-015", "Quality issues");
      // Wait for batched write to complete
      await db.waitForFlush();

      // Check activity log
      const activities = await db.getActivitiesByTraceSafe("abc-345-edf");
      const rejection = activities.find((a: { action_type: string }) => a.action_type === "review.rejected");

      assertExists(rejection);
      const payload = JSON.parse(rejection.payload);
      assertEquals(payload.rejection_reason, "Quality issues");
      // User identity is now in actor field, not rejected_by
      assertExists(rejection.actor);
    });

    it("should include rejection reason in log", async () => {
      await createFeatureBranch(tempDir, "request-016", "def-678-bca");

      await reviewCommands.reject("request-016", "Needs redesign");
      // Wait for batched write to complete
      await db.waitForFlush();

      const activities = await db.getActivitiesByTraceSafe("def-678-bca");
      const rejection = activities.find((a: { action_type: string }) => a.action_type === "review.rejected");
      assertExists(rejection);
      if (!rejection) throw new Error("Rejection not found");
      const payload = JSON.parse(rejection.payload);

      assertStringIncludes(payload.rejection_reason, "Needs redesign");
    });

    it("should handle worktree conflicts when rejecting", async () => {
      await createFeatureBranch(tempDir, "request-017", "abc-901-def");

      // Create a worktree for the branch to simulate a portal using it
      const worktreePath = join(tempDir, "worktree-portal");
      await runGitCommand(tempDir, ["worktree", "add", worktreePath, "feat/request-017-abc-901-def"]);

      // Verify worktree exists
      const worktreeList = await runGitCommand(tempDir, ["worktree", "list", "--porcelain"]);
      assertStringIncludes(worktreeList, "feat/request-017-abc-901-def");

      // Reject should handle the worktree conflict and succeed
      await reviewCommands.reject("request-017", "Worktree conflict test");

      // Verify branch was deleted despite worktree
      const branches = await runGitCommand(tempDir, ["branch", "--list", "feat/*"]);
      assertEquals(branches.includes("feat/request-017-abc-901-def"), false);

      // Verify worktree was removed
      const worktreeListAfter = await runGitCommand(tempDir, ["worktree", "list", "--porcelain"]);
      assertEquals(worktreeListAfter.includes("feat/request-017-abc-901-def"), false);

      // Clean up worktree directory
      await Deno.remove(worktreePath, { recursive: true }).catch(() => {});
    });

    it("should handle branch checked out in main working tree when rejecting", async () => {
      await createFeatureBranch(tempDir, "request-018", "def-111-ghi");

      // Switch to the feature branch in the main repository (simulating portal checked out to branch)
      await runGitCommand(tempDir, ["checkout", "feat/request-018-def-111-ghi"]);

      // Reject should handle the checkout conflict and succeed
      await reviewCommands.reject("request-018", "Checkout conflict test");

      // Verify we're back on master
      const currentBranch = await runGitCommand(tempDir, ["branch", "--show-current"]);
      assertEquals(currentBranch.trim(), TEST_DEFAULT_BRANCH);

      // Verify branch was deleted
      const branches = await runGitCommand(tempDir, ["branch", "--list", "feat/*"]);
      assertEquals(branches.includes("feat/request-018-def-111-ghi"), false);
    });

    it("should mark artifact as rejected with reason (no git)", async () => {
      const artifactRegistry = new ArtifactRegistry(db, config.system.root);
      const artifactId = await artifactRegistry.createArtifact(
        "request-artifact-004",
        "code-analyst",
        "# Reject Me\n\nThis is an artifact",
      );

      await reviewCommands.reject(artifactId, "Not useful");

      const updated = await artifactRegistry.getArtifact(artifactId);
      assertEquals(updated.status, ReviewStatus.REJECTED);
      assertEquals(updated.rejection_reason, "Not useful");
      const fileContent = await Deno.readTextFile(join(config.system.root, updated.file_path));
      assertStringIncludes(fileContent, `status: ${ReviewStatus.REJECTED}`);
    });

    it("artifact rejection should persist rejected copy and update request frontmatter", async () => {
      const requestId = "request-artifact-005";
      // Create a request file to link against
      const requestsDir = join(config.system.root, config.paths.workspace, config.paths.requests);
      await Deno.mkdir(requestsDir, { recursive: true });
      const requestPath = join(requestsDir, `${requestId}.md`);
      const requestFront = `---\ntrace_id: ${requestId}\nstatus: pending\ncreated: ${
        new Date().toISOString()
      }\ncreated_by: test-user\n---\n\nTest request body\n`;
      await Deno.writeTextFile(requestPath, requestFront);

      const artifactRegistry = new ArtifactRegistry(db, config.system.root);
      const artifactId = await artifactRegistry.createArtifact(
        requestId,
        "code-analyst",
        "# Artifact to reject\n\nBody",
      );

      await reviewCommands.reject(artifactId, "Not useful");

      // Rejected copy should exist in Workspace/Rejected
      const rejectedRelative = join(config.paths.workspace, config.paths.rejected, `${artifactId}_rejected.md`);
      const rejectedAbsolute = join(config.system.root, rejectedRelative);
      const rejectedContent = await Deno.readTextFile(rejectedAbsolute);
      assertStringIncludes(rejectedContent, "# Artifact to reject");

      // Request frontmatter should include rejected_path
      const updatedRequest = await Deno.readTextFile(requestPath);
      assertStringIncludes(updatedRequest, `rejected_path: ${rejectedRelative}`);
    });
  });

  /**
   * Regression test for: "Branch not found" error when approving reviews in portal repositories
   * Root cause: approve/show/reject methods only searched workspace root, not portal repos
   * Fix: Added findRepoForBranch() method to search all repositories
   */
  it("[regression] approve() should find and merge branches in portal repositories", async () => {
    // Create a portal repository
    const portalDir = await Deno.makeTempDir({ prefix: "portal-repo-" });
    try {
      // Initialize git repo in portal directory with master branch (like user's repo)
      await initGitRepo(portalDir); // Uses shared helper

      // Create a feature branch in the portal repository
      await createFeatureBranch(portalDir, "request-a300d5a5", "a300d5a5");

      // Create portal symlink in the workspace
      const portalsDir = join(tempDir, config.paths.portals);
      await Deno.mkdir(portalsDir, { recursive: true });
      const symlinkPath = join(portalsDir, "TestPortal");
      await Deno.symlink(portalDir, symlinkPath);

      // Verify the review appears in the list (should find it in portal)
      const reviews = await reviewCommands.list();
      assertEquals(reviews.length, 1);
      assertEquals(reviews[0].request_id, "request-a300d5a5");
      assertEquals(reviews[0].branch, "feat/request-a300d5a5-a300d5a5");

      // This should NOT throw "Branch not found" error anymore
      await reviewCommands.approve("request-a300d5a5");

      // Verify branch was merged in the portal repository
      const branches = await runGitCommand(portalDir, ["branch", "--list"]);
      assertStringIncludes(branches, `* ${TEST_DEFAULT_BRANCH}`); // Should be on main branch
      assertStringIncludes(branches, "feat/request-a300d5a5-a300d5a5"); // Branch should still exist

      // Verify merge commit exists
      const log = await runGitCommand(portalDir, ["log", "--oneline", "-3"]);
      assertStringIncludes(log, "Merge request-a300d5a5");
    } finally {
      await Deno.remove(portalDir, { recursive: true }).catch(() => {});
    }
  });
});

async function createFeatureBranch(
  repoDir: string,
  requestId: string,
  traceId: string,
  fileCount: number = 1,
): Promise<void> {
  const branchName = `feat/${requestId}-${traceId}`;

  // Create branch
  await runGitCommand(repoDir, ["checkout", "-b", branchName]);

  // Add files
  for (let i = 0; i < fileCount; i++) {
    const fileName = `feature-${i + 1}.txt`;
    await Deno.writeTextFile(join(repoDir, fileName), `feature content ${i + 1}\n`);
    await runGitCommand(repoDir, [MemoryOperation.ADD, fileName]);
  }

  // Commit
  await runGitCommand(repoDir, ["commit", "-m", `Add feature for ${requestId}\n\nTrace-Id: ${traceId}`]);

  // Switch back to default branch
  await runGitCommand(repoDir, ["checkout", TEST_DEFAULT_BRANCH]);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Additional edge case tests from tests/review_commands_test.ts
describe("ReviewCommands - Edge Cases", () => {
  let tempDir: string;
  let reviewCommands: ReviewCommands;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    // Initialize shared CLI test context
    const result = await createCliTestContext();
    tempDir = result.tempDir;
    cleanup = result.cleanup;

    // Initialize git repository with default branch (like user's repo)
    await initGitRepo(tempDir);

    reviewCommands = new ReviewCommands(result.context);
  });

  afterEach(async () => {
    await cleanup();
  });

  it("list() should skip branches with invalid naming format", async () => {
    // Create branches with various invalid formats
    await runGitCommand(tempDir, ["checkout", "-b", "feat/invalid"]);
    await runGitCommand(tempDir, ["checkout", TEST_DEFAULT_BRANCH]);

    await runGitCommand(tempDir, ["checkout", "-b", "feature/not-feat"]);
    await runGitCommand(tempDir, ["checkout", TEST_DEFAULT_BRANCH]);

    const reviews = await reviewCommands.list();
    assertEquals(reviews.length, 0);
  });

  it("list() should handle branches with no files changed", async () => {
    // Create empty feature branch (no actual file changes)
    const branchName = "feat/request-003-empty-branch";
    await runGitCommand(tempDir, ["checkout", "-b", branchName]);
    await runGitCommand(tempDir, ["commit", "--allow-empty", "-m", "Empty commit"]);
    await runGitCommand(tempDir, ["checkout", TEST_DEFAULT_BRANCH]);

    const reviews = await reviewCommands.list();
    assertEquals(reviews.length, 1);
    assertEquals(reviews[0].files_changed, 0);
  });

  it("show() should throw error when branch does not exist", async () => {
    await assertRejects(
      async () => await reviewCommands.show("feat/nonexistent-branch"),
      Error,
      "not found",
    );
  });

  it("show() should find branch by request_id", async () => {
    await createFeatureBranch(tempDir, "request-007", "abc-901-def");

    const details = await reviewCommands.show("request-007");
    assertExists(details);
    assertEquals(details.request_id, "request-007");
  });

  it("show() should throw error when request_id not found", async () => {
    await assertRejects(
      async () => await reviewCommands.show("nonexistent-request"),
      Error,
      "Review not found",
    );
  });

  it(`should throw error when not on ${TEST_DEFAULT_BRANCH} branch`, async () => {
    await createFeatureBranch(tempDir, "request-010", "def-890-abc");

    // Switch to a different branch
    await runGitCommand(tempDir, ["checkout", "-b", "other-branch"]);

    await assertRejects(
      async () => await reviewCommands.approve("request-010"),
      Error,
      TEST_DEFAULT_BRANCH,
    );

    // Switch back for cleanup
    await runGitCommand(tempDir, ["checkout", TEST_DEFAULT_BRANCH]);
  });

  it("reject() should throw error when rejection reason is empty", async () => {
    await createFeatureBranch(tempDir, "request-011", "abc-111-def");

    await assertRejects(
      async () => await reviewCommands.reject("request-011", ""),
      Error,
      "Rejection reason is required",
    );
  });

  it("reject() should throw error when rejection reason is whitespace only", async () => {
    await createFeatureBranch(tempDir, "request-012", "def-222-abc");

    await assertRejects(
      async () => await reviewCommands.reject("request-012", "   "),
      Error,
      "Rejection reason is required",
    );
  });

  it("reject() should handle rejection of non-existent branch gracefully", async () => {
    await assertRejects(
      async () => await reviewCommands.reject("nonexistent", "Not needed"),
      Error,
      "Review not found",
    );
  });
});
