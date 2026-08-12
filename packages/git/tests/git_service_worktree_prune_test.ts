/**
 * @module GitServiceWorktreePruneTest
 * @path packages/git/tests/git_service_worktree_prune_test.ts
 * @related-files []
 * @architectural-layer Services
 * @description Targeted tests for GitService worktree management, verifying correct
 * identification and cleanup of stale worktrees to prevent storage bloat.
 */

import { assert, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { ensureDir } from "@std/fs";
import {
  createMockConfig,
  GitTestHelper,
  initTestDbService,
  setupGitRepo,
  TEST_DEFAULT_BRANCH,
} from "@exaix/git/testing";
import { GitService } from "../src/git_service.ts";

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
  const gitService = new GitService({ config, repoPath: repoDir });

  await gitService.pruneWorktrees({ expire: "now" });

  const after = await helper.runGit(["worktree", "list", "--porcelain"]);
  assert(
    !after.includes(`worktree ${worktreeDir}`),
    `Expected pruned worktree to be removed from list, but it still exists:\n${after}`,
  );

  await dbService.cleanup();
});

Deno.test("GitService: removeWorktree with deleteBranch removes the worktree and its branch", async () => {
  const dbService = await initTestDbService();
  const tempDir = dbService.tempDir;

  const repoDir = join(tempDir, "repo");
  const worktreeDir = join(tempDir, "wt-delete-branch");

  await ensureDir(repoDir);
  await setupGitRepo(repoDir, { initialCommit: true, branch: TEST_DEFAULT_BRANCH });

  const helper = new GitTestHelper(repoDir);
  await helper.runGit([
    "worktree",
    "add",
    "-b",
    "feat/request-abc-123",
    worktreeDir,
    TEST_DEFAULT_BRANCH,
  ]);

  const config = createMockConfig(tempDir);
  const gitService = new GitService({ config, repoPath: repoDir });

  await gitService.removeWorktree(worktreeDir, { force: true, deleteBranch: true });

  const worktrees = await gitService.listWorktrees();
  assert(
    !worktrees.some((w) => w.path === worktreeDir),
    `Expected worktree ${worktreeDir} to be removed, but it remains:\n${worktrees.map((w) => w.path).join("\n")}`,
  );

  const branches = await helper.listBranches();
  assert(
    !branches.includes("feat/request-abc-123"),
    `Expected branch feat/request-abc-123 to be deleted, but it remains: ${branches.join(", ")}`,
  );

  await dbService.cleanup();
});

Deno.test("GitService: removeWorktree without deleteBranch keeps the branch", async () => {
  const dbService = await initTestDbService();
  const tempDir = dbService.tempDir;

  const repoDir = join(tempDir, "repo");
  const worktreeDir = join(tempDir, "wt-keep-branch");

  await ensureDir(repoDir);
  await setupGitRepo(repoDir, { initialCommit: true, branch: TEST_DEFAULT_BRANCH });

  const helper = new GitTestHelper(repoDir);
  await helper.runGit([
    "worktree",
    "add",
    "-b",
    "feat/request-keep-999",
    worktreeDir,
    TEST_DEFAULT_BRANCH,
  ]);

  const config = createMockConfig(tempDir);
  const gitService = new GitService({ config, repoPath: repoDir });

  await gitService.removeWorktree(worktreeDir, { force: true });

  const branches = await helper.listBranches();
  assert(
    branches.includes("feat/request-keep-999"),
    `Expected branch feat/request-keep-999 to be kept, but it is gone: ${branches.join(", ")}`,
  );

  await dbService.cleanup();
});

Deno.test("GitService: pruneWorktrees removes orphaned feat/request-* branches and keeps live-worktree branches", async () => {
  const dbService = await initTestDbService();
  const tempDir = dbService.tempDir;

  const repoDir = join(tempDir, "repo");
  const orphanWorktreeDir = join(tempDir, "wt-orphaned");
  const liveWorktreeDir = join(tempDir, "wt-live");

  await ensureDir(repoDir);
  await setupGitRepo(repoDir, { initialCommit: true, branch: TEST_DEFAULT_BRANCH });

  const helper = new GitTestHelper(repoDir);
  await helper.runGit([
    "worktree",
    "add",
    "-b",
    "feat/request-orphan-111",
    orphanWorktreeDir,
    TEST_DEFAULT_BRANCH,
  ]);
  await helper.runGit([
    "worktree",
    "add",
    "-b",
    "feat/request-live-222",
    liveWorktreeDir,
    TEST_DEFAULT_BRANCH,
  ]);

  // Simulate the scenario-framework leak: the /tmp worktree directory is deleted
  // out-of-band (sandbox cleanup), leaving stale metadata + an orphaned branch ref.
  await Deno.remove(orphanWorktreeDir, { recursive: true });

  const config = createMockConfig(tempDir);
  const gitService = new GitService({ config, repoPath: repoDir });

  await gitService.pruneWorktrees({ expire: "now" });

  const branches = await helper.listBranches();
  assert(
    !branches.includes("feat/request-orphan-111"),
    `Expected orphaned branch feat/request-orphan-111 to be pruned, but it remains: ${branches.join(", ")}`,
  );
  assert(
    branches.includes("feat/request-live-222"),
    `Expected live-worktree branch feat/request-live-222 to be kept, but it is gone: ${branches.join(", ")}`,
  );

  await dbService.cleanup();
});

Deno.test("GitService: pruneWorktrees dry-run does not delete orphaned request branches", async () => {
  const dbService = await initTestDbService();
  const tempDir = dbService.tempDir;

  const repoDir = join(tempDir, "repo");
  const orphanWorktreeDir = join(tempDir, "wt-dry-orphan");

  await ensureDir(repoDir);
  await setupGitRepo(repoDir, { initialCommit: true, branch: TEST_DEFAULT_BRANCH });

  const helper = new GitTestHelper(repoDir);
  await helper.runGit([
    "worktree",
    "add",
    "-b",
    "feat/request-dry-333",
    orphanWorktreeDir,
    TEST_DEFAULT_BRANCH,
  ]);
  await Deno.remove(orphanWorktreeDir, { recursive: true });

  const config = createMockConfig(tempDir);
  const gitService = new GitService({ config, repoPath: repoDir });

  await gitService.pruneWorktrees({ dryRun: true });

  const branches = await helper.listBranches();
  assert(
    branches.includes("feat/request-dry-333"),
    `Expected dry-run to keep orphaned branch feat/request-dry-333, but it was deleted: ${branches.join(", ")}`,
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
  const gitService = new GitService({ config, repoPath: repoDir });
  const worktrees = await gitService.listWorktrees();

  assert(worktrees.length >= 2, `Expected >=2 worktrees, got ${worktrees.length}`);
  assert(worktrees.some((w) => w.path === repoDir), "Expected main worktree entry to be present");
  assert(worktrees.some((w) => w.path === worktreeDir), "Expected added worktree entry to be present");

  await dbService.cleanup();
});
