/**
 * @module GitServicePortalTest
 * @path packages/git/tests/git_service_portal_test.ts
 * @description Verifies GitService operations within the context of multiple portals,
 * ensuring correct isolation and repository discovery for partitioned datasets.
 */

import { assertEquals } from "@std/assert";
import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { join } from "@std/path";
import { ensureDir } from "@std/fs";
import { GitService } from "../src/git_service.ts";
import { GitTestHelper } from "./helpers/git_test_helper.ts";
import { setupPortalGitRepos } from "./helpers/portal_test_utils.ts";
import type { Config } from "@exaix/schemas";

/**
 * TDD Tests for GitService Portal Support
 * Task 3.1: Git Service Portal Support
 *
 * Tests that GitService can work with different repository paths
 * (portal repos vs deployed workspace repo)
 */

describe("GitService Portal Support", () => {
  let tempDir: string;
  let portalRepoDir: string;
  let workspaceRepoDir: string;
  let config: Config;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ tempDir, portalRepoDir, workspaceRepoDir, config, cleanup } = await setupPortalGitRepos());
  });

  afterEach(async () => {
    if (cleanup) {
      await cleanup();
    }
  });

  describe("setRepository method", () => {
    it("accepts valid git repository path", () => {
      const gitService = new GitService({
        config,
        repoPath: workspaceRepoDir,
      });

      // Should not throw
      gitService.setRepository(portalRepoDir);

      // Verify repository was set
      assertEquals(gitService.getRepository(), portalRepoDir);
    });

    it("throws error for non-existent directory", () => {
      const gitService = new GitService({
        config,
        repoPath: workspaceRepoDir,
      });

      const nonExistentPath = join(tempDir, "does-not-exist");

      try {
        gitService.setRepository(nonExistentPath);
        throw new Error("Should have thrown error");
      } catch (error) {
        assertEquals(
          (error as Error).message,
          `Not a git repository: ${nonExistentPath}`,
        );
      }
    });

    it("throws error for directory without .git", async () => {
      const gitService = new GitService({
        config,
        repoPath: workspaceRepoDir,
      });

      const nonGitDir = join(tempDir, "not-git");
      await ensureDir(nonGitDir);

      try {
        gitService.setRepository(nonGitDir);
        throw new Error("Should have thrown error");
      } catch (error) {
        assertEquals(
          (error as Error).message,
          `Not a git repository: ${nonGitDir}`,
        );
      }
    });

    it("allows switching between repositories", () => {
      const gitService = new GitService({
        config,
        repoPath: workspaceRepoDir,
      });

      // Set to portal repo
      gitService.setRepository(portalRepoDir);
      assertEquals(gitService.getRepository(), portalRepoDir);

      // Switch back to workspace repo
      gitService.setRepository(workspaceRepoDir);
      assertEquals(gitService.getRepository(), workspaceRepoDir);
    });
  });

  describe("getRepository method", () => {
    it("returns current repository path", () => {
      const gitService = new GitService({
        config,
        repoPath: workspaceRepoDir,
      });

      assertEquals(gitService.getRepository(), workspaceRepoDir);
    });

    it("returns updated path after setRepository", () => {
      const gitService = new GitService({
        config,
        repoPath: workspaceRepoDir,
      });

      gitService.setRepository(portalRepoDir);
      assertEquals(gitService.getRepository(), portalRepoDir);
    });
  });

  describe("git operations use configured repository", () => {
    it("createBranch uses configured repository", async () => {
      const gitService = new GitService({
        config,
        repoPath: workspaceRepoDir,
      });

      // Set to portal repo
      gitService.setRepository(portalRepoDir);

      // Create branch in portal repo
      await gitService.createBranch({
        requestId: "test-request",
        traceId: "test-trace-123",
      });

      // Get the created branch name (it will have the pattern feat/test-request-test-t)
      const result = await gitService.runGitCommand(["branch", "--list", "feat/test-request-*"]);
      const _portalBranch = result.output.trim().replace("* ", "");

      // Verify branch exists in portal repo
      const portalBranches = await new GitTestHelper(portalRepoDir).listBranches();
      assertEquals(portalBranches.some((b) => b.startsWith("feat/test-request-")), true);

      // Verify branch does NOT exist in workspace repo
      const workspaceBranches = await new GitTestHelper(workspaceRepoDir).listBranches();
      assertEquals(workspaceBranches.some((b) => b.startsWith("feat/test-request-")), false);
    });

    it("getCurrentBranch reads from configured repository", async () => {
      const gitService = new GitService({
        config,
        repoPath: workspaceRepoDir,
      });

      // Create different branches in each repo
      await new GitTestHelper(portalRepoDir).runGit(["checkout", "-b", "portal-feature"]);
      await new GitTestHelper(workspaceRepoDir).runGit(["checkout", "-b", "workspace-feature"]);

      // Check workspace repo
      const workspaceBranch = await gitService.getCurrentBranch();
      assertEquals(workspaceBranch, "workspace-feature");

      // Switch to portal repo
      gitService.setRepository(portalRepoDir);
      const portalBranch = await gitService.getCurrentBranch();
      assertEquals(portalBranch, "portal-feature");
    });
  });

  describe("repository isolation", () => {
    it("operations in portal repo don't affect workspace repo", async () => {
      const gitService = new GitService({
        config,
        repoPath: workspaceRepoDir,
      });

      // Set to portal repo and create branch
      gitService.setRepository(portalRepoDir);
      await gitService.createBranch({
        requestId: "portal-only",
        traceId: "test-trace-456",
      });

      // Switch to workspace repo
      gitService.setRepository(workspaceRepoDir);
      const workspaceBranches = await new GitTestHelper(workspaceRepoDir).listBranches();

      // Verify portal branch doesn't exist in workspace
      assertEquals(workspaceBranches.some((b) => b.startsWith("feat/portal-only-")), false);
    });

    it("multiple GitService instances can target different repos", async () => {
      const portalGitService = new GitService({
        config,
        repoPath: portalRepoDir,
      });

      const workspaceGitService = new GitService({
        config,
        repoPath: workspaceRepoDir,
      });

      // Create branches in different repos
      await portalGitService.createBranch({
        requestId: "portal",
        traceId: "trace-portal",
      });
      await workspaceGitService.createBranch({
        requestId: "workspace",
        traceId: "trace-workspace",
      });

      // Verify isolation
      const portalBranches = await new GitTestHelper(portalRepoDir).listBranches();
      const workspaceBranches = await new GitTestHelper(workspaceRepoDir).listBranches();

      assertEquals(portalBranches.some((b) => b.startsWith("feat/portal-")), true);
      assertEquals(portalBranches.some((b) => b.startsWith("feat/workspace-")), false);

      assertEquals(workspaceBranches.some((b) => b.startsWith("feat/workspace-")), true);
      assertEquals(workspaceBranches.some((b) => b.startsWith("feat/portal-")), false);
    });
  });
});
