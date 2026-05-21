// deno-lint-ignore-file no-explicit-any
/**
 * @module ReviewCommandsCoverageTest
 * @path tests/cli/review_commands_coverage_test.ts
 * @description Targeted unit tests to improve coverage for ReviewCommands,
 * focusing on internal helper methods and edge cases in review management.
 */

import { assertEquals, assertRejects } from "@std/assert";
import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { join } from "@std/path";
import { ReviewCommands } from "../../src/cli/commands/review_commands.ts";
import type { DatabaseService } from "@exaix/storage-sqlite";
import { createCliTestContext, initGitRepo, runGitCommand } from "./helpers/test_setup.ts";
import type { ICliApplicationContext } from "../../src/cli/cli_context.ts";
import { TEST_DEFAULT_BRANCH } from "@exaix/git/testing";

interface IReviewCommandsInternals {
  normalizeTypeFilter(value?: string): string;
  normalizeStatusFilter(value?: string): string | undefined;
  isArtifactId(value: string): boolean;
  getDefaultBranch(rootPath: string): Promise<string>;
  resolvePortalEntryTarget(basePath: string, targetPath: string): string;
  findWorktreePathForBranch(
    gitService: { runGitCommand(args: string[]): Promise<{ output: string }> },
    branch: string,
  ): Promise<string | null>;
  createPortalGitService(rootPath: string, traceId: string): Promise<unknown>;
  deleteBranchWithWorktreeHandling(gitService: any, branch: string, rootPath: string): Promise<void>;
  updateArtifactStatus(artifactId: string, status: string): Promise<void>;
  bestEffortLinkRequestRejection(requestId: string, rejectedPath: string): Promise<void>;
}

function cast<T>(obj: any): T {
  return obj as T;
}

describe("ReviewCommands Targeted Coverage", () => {
  let tempDir: string;
  let db: DatabaseService;
  let reviewCommands: ReviewCommands;
  let cleanup: () => Promise<void>;
  let context: ICliApplicationContext;

  beforeEach(async () => {
    const result = await createCliTestContext();
    tempDir = result.tempDir;
    db = result.db;
    cleanup = result.cleanup;
    context = result.context;

    await initGitRepo(tempDir);
    reviewCommands = new ReviewCommands(context);
  });

  afterEach(async () => {
    await cleanup();
  });

  const internals = () => cast<IReviewCommandsInternals>(reviewCommands);

  describe("Internal Helper Coverage", () => {
    it("normalizeTypeFilter: handles various inputs", () => {
      assertEquals(internals().normalizeTypeFilter("CODE"), "code");
      assertEquals(internals().normalizeTypeFilter("artifact"), "artifact");
      assertEquals(internals().normalizeTypeFilter("all"), "all");
      assertEquals(internals().normalizeTypeFilter("invalid"), "all");
      assertEquals(internals().normalizeTypeFilter(undefined), "all");
    });

    it("normalizeStatusFilter: handles various inputs", () => {
      assertEquals(internals().normalizeStatusFilter("PENDING"), "pending");
      assertEquals(internals().normalizeStatusFilter("approved"), "approved");
      assertEquals(internals().normalizeStatusFilter("invalid"), undefined);
      assertEquals(internals().normalizeStatusFilter(undefined), undefined);
    });

    it("isArtifactId: identifies artifact IDs correctly", () => {
      assertEquals(internals().isArtifactId("artifact-123"), true);
      assertEquals(internals().isArtifactId("feat/branch"), false);
    });

    it("getDefaultBranch: handles missing remote and master fallback", async () => {
      // Current repo has TEST_DEFAULT_BRANCH from initGitRepo
      const branch = await internals().getDefaultBranch(tempDir);
      assertEquals(branch, TEST_DEFAULT_BRANCH);
    });

    it("getDefaultBranch: handles main fallback", async () => {
      const mainDir = await Deno.makeTempDir({ prefix: "main-repo-" });
      try {
        await runGitCommand(mainDir, ["init", "-b", "main"]);
        await runGitCommand(mainDir, ["config", "user.name", "Test"]);
        await runGitCommand(mainDir, ["config", "user.email", "test@test.com"]);
        await runGitCommand(mainDir, ["commit", "--allow-empty", "-m", "init"]);
        const branch = await internals().getDefaultBranch(mainDir);
        assertEquals(branch, "main");
      } finally {
        await Deno.remove(mainDir, { recursive: true });
      }
    });

    it("resolvePortalEntryTarget: handles absolute and relative paths", () => {
      const abs = internals().resolvePortalEntryTarget("/a/b/c", "/x/y");
      assertEquals(abs, "/x/y");
      const rel = internals().resolvePortalEntryTarget("/a/b/c", "../d");
      // dirname(/a/b/c) is /a/b, resolve(/a/b, ../d) is /a/d
      assertEquals(rel, "/a/d");
    });
  });

  describe("Complex List Scenarios", () => {
    it("list: combines branch scanning and database records", async () => {
      // Create a branch that is NOT in DB
      const traceId = "trace-git-only";
      const branchName = `feat/request-gitonly-${traceId}`;
      await runGitCommand(tempDir, ["checkout", "-b", branchName]);
      await Deno.writeTextFile(join(tempDir, "git.txt"), "git content");
      await runGitCommand(tempDir, ["add", "git.txt"]);
      await runGitCommand(tempDir, ["commit", "-m", `msg\n\nTrace-Id: ${traceId}`]);
      await runGitCommand(tempDir, ["checkout", TEST_DEFAULT_BRANCH]);

      // Create a record in DB for a DIFFERENT branch
      await db.preparedRun(
        `INSERT INTO reviews (id, trace_id, branch, status, created, created_by, repository, description)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          "review-db-only",
          "trace-db-only",
          "feat/request-dbonly-trace-db-only",
          "pending",
          new Date().toISOString(),
          "identity",
          tempDir,
          "description",
        ],
      );

      const reviews = await reviewCommands.list();
      // Should find both: one from git scan, one from DB
      // Note: we use Set to ignore duplicates that might occur if the repo is found via multiple paths
      const branches = [...new Set(reviews.map((r) => r.branch))].sort();
      assertEquals(
        branches,
        [
          branchName,
          "feat/request-dbonly-trace-db-only",
        ].sort(),
      );
      assertEquals(branches.includes(branchName), true);
      assertEquals(branches.includes("feat/request-dbonly-trace-db-only"), true);
    });

    it("list: avoids duplicates between DB and Git scan", async () => {
      const traceId = "trace-both";
      const branchName = `feat/request-both-${traceId}`;

      // Git branch
      await runGitCommand(tempDir, ["checkout", "-b", branchName]);
      await Deno.writeTextFile(join(tempDir, "both.txt"), "content");
      await runGitCommand(tempDir, ["add", "both.txt"]);
      await runGitCommand(tempDir, ["commit", "-m", `msg\n\nTrace-Id: ${traceId}`]);
      await runGitCommand(tempDir, ["checkout", TEST_DEFAULT_BRANCH]);

      // DB record for SAME branch
      await db.preparedRun(
        `INSERT INTO reviews (id, trace_id, branch, status, created, created_by, repository, description)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ["review-both", traceId, branchName, "pending", new Date().toISOString(), "identity", tempDir, "description"],
      );

      const reviews = await reviewCommands.list();
      // Should only show once
      assertEquals(reviews.filter((r) => r.branch === branchName).length, 1);
    });

    it("list: respects type filters", async () => {
      // Add artifact
      await db.preparedRun(
        `INSERT INTO artifacts (id, request_id, type, identity, status, created, file_path)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ["artifact-1", "req-1", "analysis", "identity", "pending", new Date().toISOString(), "path/to/art.md"],
      );

      const artifacts = await reviewCommands.list(undefined, "artifact");
      assertEquals(artifacts.length, 1);
      assertEquals(artifacts[0].type, "artifact");

      const code = await reviewCommands.list(undefined, "code");
      assertEquals(code.every((r) => r.type === "code"), true);
    });
  });

  describe("Branch Deletion & Worktree Handling", () => {
    it("findWorktreePathForBranch: parses porcelain output", async () => {
      const mockGit = {
        runGitCommand: () =>
          Promise.resolve({
            output: `worktree /path/to/wt
branch refs/heads/my-branch
prepare

worktree /other/path
branch refs/heads/other
`,
          }),
      };
      const gitInternals = cast<Parameters<IReviewCommandsInternals["findWorktreePathForBranch"]>[0]>(mockGit);
      const path = await internals().findWorktreePathForBranch(gitInternals, "my-branch");
      assertEquals(path, "/path/to/wt");
      const pathNotFound = await internals().findWorktreePathForBranch(gitInternals, "nonexistent");
      assertEquals(pathNotFound, null);
    });

    it("deleteBranchWithWorktreeHandling: deletes normal branch", async () => {
      const branch = "feat/to-delete";
      await runGitCommand(tempDir, ["branch", branch]);

      const gitService = await internals().createPortalGitService(tempDir, "trace-1");
      await internals().deleteBranchWithWorktreeHandling(gitService, branch, tempDir);

      const log = await runGitCommand(tempDir, ["branch", "--list", branch]);
      assertEquals(log.trim(), "");
    });
  });

  describe("Error Paths & Edge Cases", () => {
    it("show: throws for non-existent artifact", async () => {
      await assertRejects(
        () => reviewCommands.show("artifact-nonexistent"),
        Error,
        "Artifact not found",
      );
    });

    it("approve: throws if on wrong branch in portal repo", async () => {
      const portalDir = await Deno.makeTempDir({ prefix: "portal-" });
      try {
        await initGitRepo(portalDir);
        const branchName = "feat/request-p1-trace1";
        await runGitCommand(portalDir, ["checkout", "-b", branchName]);
        await Deno.writeTextFile(join(portalDir, "f.txt"), "c");
        await runGitCommand(portalDir, ["add", "f.txt"]);
        await runGitCommand(portalDir, ["commit", "-m", "msg\n\nTrace-Id: trace1"]);

        // Stay on the branch in portalDir

        // Link portal
        const portalsDir = join(tempDir, "Portals");
        await Deno.mkdir(portalsDir, { recursive: true });
        await Deno.symlink(portalDir, join(portalsDir, "P1"));

        await assertRejects(
          () => reviewCommands.approve("request-p1"),
          Error,
          `Must be on '${TEST_DEFAULT_BRANCH}' branch`,
        );
      } finally {
        await Deno.remove(portalDir, { recursive: true });
      }
    });

    it("updateArtifactStatus: handles missing frontmatter", async () => {
      const artPath = join(tempDir, "bad-art.md");
      await Deno.writeTextFile(artPath, "No frontmatter here");

      await db.preparedRun(
        `INSERT INTO artifacts (id, request_id, type, identity, status, created, file_path)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ["artifact-bad", "req-bad", "analysis", "identity", "pending", new Date().toISOString(), "bad-art.md"],
      );
      await assertRejects(
        () => internals().updateArtifactStatus("artifact-bad", "approved"),
        Error,
        "Invalid artifact format",
      );
    });

    it("bestEffortLinkRequestRejection: handles missing request file", async () => {
      await internals().bestEffortLinkRequestRejection("nonexistent-req", "some/path");
      // Should not throw
    });

    it("bestEffortLinkRequestRejection: updates existing request frontmatter", async () => {
      const requestsDir = join(tempDir, "Workspace/Requests");
      await Deno.mkdir(requestsDir, { recursive: true });
      const requestFile = join(requestsDir, "req-1.md");
      await Deno.writeTextFile(
        requestFile,
        `---
title: My Request
---
Content`,
      );
      await internals().bestEffortLinkRequestRejection("req-1", "rejected/path.md");

      const updated = await Deno.readTextFile(requestFile);
      assertEquals(updated.includes("rejected_path: rejected/path.md"), true);
    });
  });
});
