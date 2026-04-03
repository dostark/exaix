/**
 * @module GitServiceWorktreePruneTest
 * @path tests/services/git/git_service_worktree_prune_test.ts
 * @description Targeted tests for GitService worktree management, verifying correct
 * identification and cleanup of stale worktrees to prevent storage bloat.
 */

import { assert, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { ensureDir } from "@std/fs";
import { GitService } from "../../../src/services/core/git_service.ts";
import { createMockConfig } from "../../helpers/config.ts";
import { initTestDbService } from "../../helpers/db.ts";
import { GitTestHelper, setupGitRepo } from "../../helpers/git_test_helper.ts";
import { TEST_DEFAULT_BRANCH } from "../../helpers/constants.ts";

Deno.test("GitService: pruneWorktrees removes stale worktree metadata", async () => {
  const dbService = await initTestDbService();
  const tempDir = dbService.tempDir;

  const repoDir = join(tempDir, "repo");
  const worktreeDir = join(tempDir, "worktree-deleted");

  await ensureDir(repoDir);
  await setupGitRepo(repoDir, { initialCommit: true, branch: TEST_DEFAULT_BRANCH });

  const helper = new GitTestHelper(repoDir);

  // Create a worktree, then delete it manually to leave stale metadata.
  await helper.runGit(["worktree", "add", "-b", "wt-prune-test", worktreeDir, TEST_DEFAULT_BRANCH]);
  await Deno.remove(worktreeDir, { recursive: true });

  const before = await helper.runGit(["worktree", "list", "--porcelain"]);
  assertStringIncludes(before, `worktree ${worktreeDir}`);

  const config = createMockConfig(tempDir);
  const gitService = new GitService({ config, db: dbService.db, repoPath: repoDir });

  await gitService.pruneWorktrees({ expire: "now" });

  const after = await helper.runGit(["worktree", "list", "--porcelain"]);
  assert(
    !after.includes(`worktree ${worktreeDir}`),
    `Expected pruned worktree to be removed from list, but it still exists:\n${after}`,
  );

  await dbService.cleanup();
});

Deno.test("GitService: listWorktrees returns structured entries", async () => {
  const dbService = await initTestDbService();
  const tempDir = dbService.tempDir;

  const repoDir = join(tempDir, "repo");
  const worktreeDir = join(tempDir, "worktree");

  await ensureDir(repoDir);
  await setupGitRepo(repoDir, { initialCommit: true, branch: TEST_DEFAULT_BRANCH });

  const helper = new GitTestHelper(repoDir);
  await helper.runGit(["worktree", "add", "-b", "wt-list-test", worktreeDir, TEST_DEFAULT_BRANCH]);

  const config = createMockConfig(tempDir);
  const gitService = new GitService({ config, db: dbService.db, repoPath: repoDir });
  const worktrees = await gitService.listWorktrees();

  assert(worktrees.length >= 2, `Expected >=2 worktrees, got ${worktrees.length}`);
  assert(worktrees.some((w) => w.path === repoDir), "Expected main worktree entry to be present");
  assert(worktrees.some((w) => w.path === worktreeDir), "Expected added worktree entry to be present");

  await dbService.cleanup();
});
