/**
 * @module GitServiceTest
 * @path tests/git_service_test.ts
 * @description Verifies the Git service wrapper, ensuring stable execution of
 * version control operations and correct parsing of git status and diff outputs.
 */

import { assert, assertEquals, assertExists, assertRejects } from "@std/assert";
import { FlowStepType } from "../../src/shared/enums.ts";

import { join } from "@std/path";
import {
  GitCorruptionError,
  GitError,
  GitLockError,
  GitNothingToCommitError,
  GitRepositoryError,
  GitService,
} from "../../src/services/git_service.ts";
import { DEFAULT_GIT_EXIT_CODE_FATAL } from "../../src/shared/constants.ts";
import { createMockConfig } from "../helpers/config.ts";
import { createGitTestContext, GitTestHelper } from "../helpers/git_test_helper.ts";

/**
 * Tests for Step 4.2: Git Integration (Identity Aware)
 *
 * Success Criteria:
 * - Auto-initializes git repository if not present
 * - Auto-configures git identity if missing
 * - Creates feature branches with naming convention: feat/{requestId}-{traceId}
 * - Commits with trace_id in commit message footer
 * - Handles branch name conflicts (appends timestamp)
 * - Validates changes exist before commit
 * - All git operations logged to IActivity Journal
 */

Deno.test("GitService: auto-initializes repository if not present", async () => {
  const { repoDir, db, cleanup, git } = await createGitTestContext("git-test-init-");
  const helper = new GitTestHelper(repoDir);

  try {
    await git.ensureRepository();
    await helper.assertRepositoryExists();

    // Allow time for batched logging
    await new Promise((resolve) => setTimeout(resolve, 150));

    // Verify git.init logged
    const logs = db.instance.prepare(
      "SELECT * FROM activity WHERE action_type = ?",
    ).all("git.init");
    assertEquals(logs.length, 1);
  } finally {
    await cleanup();
  }
});

Deno.test("GitService: auto-configures identity if missing", async () => {
  const { repoDir, cleanup, git } = await createGitTestContext("git-test-identity-");
  const helper = new GitTestHelper(repoDir);

  try {
    await git.ensureRepository();
    await git.ensureIdentity();

    const userName = await helper.getUserName();
    assertExists(userName);
    assert(
      userName.includes("Exaix") || userName.includes("bot"),
      `Expected username to contain Exaix or bot, got: ${userName}`,
    );
  } finally {
    await cleanup();
  }
});

Deno.test("GitService: creates branch with naming convention", async () => {
  const { repoDir, cleanup, git } = await createGitTestContext("git-test-branch-");
  const helper = new GitTestHelper(repoDir);

  try {
    await git.ensureRepository();
    await git.ensureIdentity();

    const branchName = await git.createBranch({
      requestId: "implement-auth",
      traceId: "550e8400-e29b-41d4-a716",
    });

    assertEquals(branchName, "feat/implement-auth-550e8400");
    await helper.assertBranchExists(branchName);
  } finally {
    await cleanup();
  }
});

Deno.test("GitService: handles duplicate branch names", async () => {
  const { cleanup, git } = await createGitTestContext("git-test-dup-");

  try {
    await git.ensureRepository();
    await git.ensureIdentity();

    const branch1 = await git.createBranch({
      requestId: "test-feature",
      traceId: "abc123",
    });

    const branch2 = await git.createBranch({
      requestId: "test-feature",
      traceId: "abc123",
    });

    // Second branch should have timestamp suffix
    assertEquals(branch1, "feat/test-feature-abc123");
    assertEquals(branch2.startsWith("feat/test-feature-abc123-"), true);
    assertEquals(branch1 !== branch2, true);
  } finally {
    await cleanup();
  }
});

Deno.test("GitService: commits with trace_id footer", async () => {
  const { repoDir, cleanup, git } = await createGitTestContext("git-test-commit-");
  const helper = new GitTestHelper(repoDir);

  try {
    await git.ensureRepository();
    await git.ensureIdentity();
    await helper.createFile("test.txt", "content");

    await git.commit({
      message: "Add test file",
      traceId: "550e8400-e29b-41d4-a716-446655440000",
    });

    const commitMsg = await helper.getLastCommitMessage();
    assertEquals(commitMsg.includes("Add test file"), true);
    assertEquals(commitMsg.includes("[ExaTrace: 550e8400-e29b-41d4-a716-446655440000]"), true);
  } finally {
    await cleanup();
  }
});

Deno.test("GitService: rejects commit with no changes", async () => {
  const { cleanup, git } = await createGitTestContext("git-test-nochange-");

  try {
    await git.ensureRepository();
    await git.ensureIdentity();

    // Try to commit with no changes
    await assertRejects(
      async () => {
        await git.commit({
          message: "Empty commit",
          traceId: "test-trace",
        });
      },
      Error,
      "nothing to commit",
    );
  } finally {
    await cleanup();
  }
});

Deno.test("GitService: logs all git operations", async () => {
  const { tempDir, cleanup, db } = await createGitTestContext("git-test-log-");

  try {
    const config = createMockConfig(tempDir);
    const git = new GitService({ config, db, traceId: "test-trace-456", identityId: "git-agent" });

    await git.ensureRepository();
    await git.ensureIdentity();
    await git.createBranch({ requestId: "test", traceId: "abc" });

    // Allow time for batched logging
    await new Promise((resolve) => setTimeout(resolve, 150));

    // Verify operations logged
    const logs = db.getActivitiesByTrace("test-trace-456");
    const gitLogs = logs.filter((log) => log.action_type.startsWith("git."));

    assertEquals(gitLogs.length >= 3, true); // init, identity, branch

    // Check identity_id is tracked
    const agentLogs = logs.filter((log) => log.identity_id === "git-agent");
    assertEquals(agentLogs.length >= 1, true);
  } finally {
    await cleanup();
  }
});

Deno.test("GitService: handles git command failures", async () => {
  const { cleanup, git } = await createGitTestContext("git-test-fail-");

  try {
    await git.ensureRepository();

    // Try to checkout non-existent branch
    await assertRejects(
      async () => {
        await git.checkoutBranch("nonexistent-branch");
      },
      Error,
      FlowStepType.BRANCH,
    );
  } finally {
    await cleanup();
  }
});

Deno.test("GitService: commit message format is correct", async () => {
  const { repoDir, cleanup, git } = await createGitTestContext("git-test-format-");
  const helper = new GitTestHelper(repoDir);

  try {
    await git.ensureRepository();
    await git.ensureIdentity();
    await helper.createFile("code.ts", "console.log('test')");

    await git.commit({
      message: "Implement feature X",
      description: "Added function to handle user input",
      traceId: "trace-123",
    });

    const commitMsg = await helper.getLastCommitMessage();
    assertEquals(commitMsg.includes("Implement feature X"), true);
    assertEquals(commitMsg.includes("Added function to handle user input"), true);
    assertEquals(commitMsg.includes("[ExaTrace: trace-123]"), true);
  } finally {
    await cleanup();
  }
});

class TestGitService extends GitService {
  public static testParseWorktreeListPorcelain(output: string) {
    return this.parseWorktreeListPorcelain(output);
  }
  public testIsLockError(error: unknown) {
    return this.isLockError(error);
  }
}

Deno.test("GitService: parseWorktreeListPorcelain handles flags", () => {
  const output = [
    "worktree /repo",
    "HEAD 0123456789abcdef",
    "branch refs/heads/main",
    "locked",
    "prunable",
    "worktree /repo/wt1",
    "HEAD fedcba9876543210",
    "detached",
    "locked reason",
    "prunable because",
    "",
  ].join("\n");

  const worktrees = TestGitService.testParseWorktreeListPorcelain(output);

  assertEquals(worktrees.length, 2);
  assertEquals(worktrees[0].path, "/repo");
  assertEquals(worktrees[0].locked, true);
  assertEquals(worktrees[0].prunable, true);
  assertEquals(worktrees[1].path, "/repo/wt1");
  assertEquals(worktrees[1].detached, true);
  assertEquals(worktrees[1].locked, true);
  assertEquals(worktrees[1].prunable, true);
});

Deno.test("GitService: classifyGitError maps common stderr patterns", () => {
  const config = createMockConfig("/tmp/git-classify");
  const git = new GitService({ config, repoPath: "/tmp/git-classify" });

  const repoError = git.classifyGitError(128, "not a git repository", ["status"]);
  assertEquals(repoError instanceof GitRepositoryError, true);

  const lockError = git.classifyGitError(1, "index.lock exists", ["status"]);
  assertEquals(lockError instanceof GitLockError, true);

  const corruptionError = git.classifyGitError(1, "corrupt loose object", ["status"]);
  assertEquals(corruptionError instanceof GitCorruptionError, true);

  const invalidState = git.classifyGitError(DEFAULT_GIT_EXIT_CODE_FATAL, "fatal", ["status"]);
  assertEquals(invalidState instanceof GitRepositoryError, true);

  const nothingToCommit = git.classifyGitError(1, "nothing to commit", ["commit"]);
  assertEquals(nothingToCommit instanceof GitNothingToCommitError, true);

  const genericError = git.classifyGitError(1, "unknown", ["log"]);
  assertEquals(genericError instanceof GitError, true);
});

Deno.test("GitService: isLockError identifies lock errors", () => {
  const config = createMockConfig("/tmp/git-lock-error");
  const git = new TestGitService({ config, repoPath: "/tmp/git-lock-error" });

  const isLock = git.testIsLockError(new Error("index.lock exists"));
  const isNotLock = git.testIsLockError(new Error("something else"));

  assertEquals(isLock, true);
  assertEquals(isNotLock, false);
});

Deno.test("GitService: works in already initialized repository", async () => {
  const { repoDir, cleanup, git } = await createGitTestContext("git-test-existing-");
  const helper = new GitTestHelper(repoDir);

  try {
    // Initialize git manually
    await helper.runGit(["init"]);
    await helper.runGit(["config", "user.name", "Manual User"]);
    await helper.runGit(["config", "user.email", "manual@test.com"]);

    // Should not fail on already initialized repo
    await git.ensureRepository();
    await git.ensureIdentity();

    // Should be able to create branch
    const branch = await git.createBranch({
      requestId: "test",
      traceId: "xyz",
    });

    assertExists(branch);
  } finally {
    await cleanup();
  }
});

Deno.test("GitService: createBranch - generates unique branch names on conflict", async () => {
  const { repoDir, cleanup, git } = await createGitTestContext("git-test-unique-");
  const helper = new GitTestHelper(repoDir);

  try {
    await git.ensureRepository();
    await git.ensureIdentity();
    await helper.createFileAndCommit("file.txt", "content", "Initial");

    // Create first branch
    const branch1 = await git.createBranch({
      requestId: "request-999",
      traceId: "same-trace",
    });

    // Try to create another with same IDs - should get different name
    const branch2 = await git.createBranch({
      requestId: "request-999",
      traceId: "same-trace",
    });

    // Both should exist but be different
    assertEquals(branch1 !== branch2, true);
    assertEquals(branch1.startsWith("feat/request-999-"), true);
    assertEquals(branch2.startsWith("feat/request-999-"), true);
  } finally {
    await cleanup();
  }
});

Deno.test("GitService: commit - validates files exist before committing", async () => {
  const { cleanup, git } = await createGitTestContext("git-test-valid-");

  try {
    await git.ensureRepository();
    await git.ensureIdentity();

    // Try to commit with no changes
    await assertRejects(
      async () =>
        await git.commit(
          { message: "Test", traceId: "trace-123" },
        ),
      Error,
    );
  } finally {
    await cleanup();
  }
});

Deno.test("GitService: ensureIdentity - uses git config if available", async () => {
  const { repoDir, cleanup, git } = await createGitTestContext("git-test-identity-");
  const helper = new GitTestHelper(repoDir);

  try {
    // Initialize with existing identity
    await helper.runGit(["init"]);
    await helper.runGit(["config", "user.name", "Existing User"]);
    await helper.runGit(["config", "user.email", "existing@test.com"]);

    // Should not override existing identity
    await git.ensureIdentity();

    // Verify identity wasn't changed
    const name = await helper.getUserName();
    assertEquals(name, "Existing User");
  } finally {
    await cleanup();
  }
});

Deno.test("GitService: commit - handles git add failures", async () => {
  const { repoDir, cleanup, git } = await createGitTestContext("git-test-add-fail-");
  const helper = new GitTestHelper(repoDir);

  try {
    await git.ensureRepository();
    await git.ensureIdentity();

    // Create a file
    await helper.createFile("test.txt", "content");

    // Remove git directory to cause add to fail
    await Deno.remove(join(repoDir, ".git"), { recursive: true });

    // Should handle git commit failure (no .git dir)
    await assertRejects(
      async () =>
        await git.commit(
          { message: "Test", traceId: "trace-123" },
        ),
      Error,
    );
  } finally {
    await cleanup();
  }
});

Deno.test("GitService: commit - includes description in commit message", async () => {
  const { repoDir, cleanup, git } = await createGitTestContext("git-test-desc-");
  const helper = new GitTestHelper(repoDir);

  try {
    await git.ensureRepository();
    await git.ensureIdentity();

    // Create and commit file with description
    await helper.createFile("described.txt", "content");

    await git.commit(
      {
        message: "Add file",
        description: "This is a longer description\nwith multiple lines",
        traceId: "trace-789",
      },
    );

    // Verify commit message includes description
    const commitMsg = await helper.getLastCommitMessage();

    assertEquals(commitMsg.includes("Add file"), true);
    assertEquals(commitMsg.includes("This is a longer description"), true);
    assertEquals(commitMsg.includes("ExaTrace: trace-789"), true);
  } finally {
    await cleanup();
  }
});

// ============================================================================
// Additional Coverage Tests for Checkout Branch
// ============================================================================

Deno.test("GitService: checkoutBranch - logs successful checkout", async () => {
  const { repoDir, cleanup, db } = await createGitTestContext("git-test-checkout-");
  const helper = new GitTestHelper(repoDir);

  try {
    const config = createMockConfig(repoDir);
    const git = new GitService({ config, db, traceId: "checkout-trace" });

    await git.ensureRepository();
    await git.ensureIdentity();
    await helper.createFileAndCommit("init.txt", "initial", "Initial commit");

    // Create a branch first
    const branchName = await git.createBranch({
      requestId: "checkout-test",
      traceId: "abc",
    });

    // Switch back to main/master
    await helper.runGit(["checkout", "-"]);

    // Now checkout the created branch
    await git.checkoutBranch(branchName);

    // Allow time for batched logging
    await new Promise((resolve) => setTimeout(resolve, 150));

    // Verify checkout was logged
    const logs = db.getActivitiesByTrace("checkout-trace");
    const checkoutLogs = logs.filter((log) => log.action_type === "git.checkout");

    assertEquals(checkoutLogs.length >= 1, true);
    const checkoutLog = checkoutLogs[0];
    const payload = JSON.parse(checkoutLog.payload);
    assertEquals(payload.branch, branchName);
    assertEquals(payload.success, true);
  } finally {
    await cleanup();
  }
});

Deno.test("GitService: checkoutBranch - logs checkout failure", async () => {
  const { tempDir, cleanup, db } = await createGitTestContext("git-test-checkout-fail-");

  try {
    const config = createMockConfig(tempDir);
    const git = new GitService({ config, db, traceId: "checkout-fail-trace" });

    await git.ensureRepository();
    await git.ensureIdentity();

    // Try to checkout non-existent branch
    let errorCaught = false;
    try {
      await git.checkoutBranch("nonexistent-branch-12345");
    } catch {
      errorCaught = true;
    }

    assertEquals(errorCaught, true);

    // Allow time for batched logging
    await new Promise((resolve) => setTimeout(resolve, 150));

    // Verify failure was logged
    const logs = db.getActivitiesByTrace("checkout-fail-trace");

    // At minimum, the operation should be tracked even if it failed
    assertEquals(logs.length >= 1, true);
  } finally {
    await cleanup();
  }
});

Deno.test("GitService: runGitCommand via commit - handles various message formats", async () => {
  const { repoDir, cleanup, git } = await createGitTestContext("git-test-msg-");
  const helper = new GitTestHelper(repoDir);

  try {
    await git.ensureRepository();
    await git.ensureIdentity();

    // Create initial file with multiline content
    await helper.createFile("multiline.txt", "line1\nline2\nline3");

    // Commit with a message containing special characters
    await git.commit({
      message: "feat: add file with special chars (test)",
      traceId: "special-chars-trace",
    });

    // Verify commit message
    const commitMsg = await helper.getLastCommitMessage();

    assertEquals(commitMsg.includes("feat: add file"), true);
    assertEquals(commitMsg.includes("special-chars-trace"), true);
  } finally {
    await cleanup();
  }
});

Deno.test("GitService: branch operations preserve traceId context", async () => {
  const { repoDir, cleanup, db } = await createGitTestContext("git-test-trace-");
  const helper = new GitTestHelper(repoDir);

  try {
    const traceId = "preserved-trace-id-123";
    const identityId = "test-agent";
    const config = createMockConfig(repoDir);
    const git = new GitService({ config, db, traceId, identityId });

    await git.ensureRepository();
    await git.ensureIdentity();
    await helper.createFileAndCommit("init.txt", "initial", "Initial commit");

    // Create branch with trace context
    await git.createBranch({
      requestId: "context-test",
      traceId: "branch-specific-trace",
    });

    // Allow time for batched logging
    await new Promise((resolve) => setTimeout(resolve, 150));

    // Verify all operations have the service-level traceId
    const logs = db.getActivitiesByTrace(traceId);

    assertEquals(logs.length >= 1, true);

    // Verify identity_id is preserved
    const agentLogs = logs.filter((log) => log.identity_id === identityId);
    assertEquals(agentLogs.length >= 1, true);
  } finally {
    await cleanup();
  }
});

// ============================================================================
// Issue #8: Git Service Without Proper Error Recovery - Verification Tests
// ============================================================================

Deno.test("GitService: handles repository lock conflicts with retry", async () => {
  const { repoDir, cleanup, git } = await createGitTestContext("git-test-lock-");
  const _helper = new GitTestHelper(repoDir);

  try {
    // Initialize repository
    await git.ensureRepository();
    await git.ensureIdentity();

    // Create a lock file to simulate repository lock
    const lockPath = join(repoDir, ".git", "index.lock");
    await Deno.writeTextFile(lockPath, "locked");

    // This should retry and eventually succeed or timeout gracefully
    const result = await git.runGitCommand(["status", "--porcelain"], {
      timeoutMs: 1000, // Short timeout for test
      retryOnLock: true,
    });

    // Should either succeed after lock is released or timeout gracefully
    assert(typeof result.exitCode === "number");
  } finally {
    await cleanup();
  }
});

Deno.test("GitService: classifies git errors appropriately", async () => {
  const { repoDir, cleanup, git } = await createGitTestContext("git-test-errors-");
  const _helper = new GitTestHelper(repoDir);

  try {
    // Initialize repository
    await git.ensureRepository();
    await git.ensureIdentity();

    // Test repository corruption error (simulate by corrupting a git object)
    const error = git.classifyGitError(128, "fatal: loose object file corrupted", ["status"]);
    assert(error instanceof GitCorruptionError);

    // Test lock error
    const lockError = git.classifyGitError(128, "fatal: Unable to create '.git/index.lock'", ["commit"]);
    assert(lockError instanceof GitLockError);

    // Test nothing to commit
    const nothingError = git.classifyGitError(1, "nothing to commit, working tree clean", ["commit"]);
    assert(nothingError instanceof GitNothingToCommitError);
  } finally {
    await cleanup();
  }
});

Deno.test("GitService: timeout protection is configurable", async () => {
  const { repoDir, cleanup, git } = await createGitTestContext("git-test-timeout-");
  const _helper = new GitTestHelper(repoDir);

  try {
    // Initialize repository with some content
    await git.ensureRepository();
    await git.ensureIdentity();
    await Deno.writeTextFile(join(repoDir, "test.txt"), "content");
    await git.commit({ message: "Initial commit", traceId: "test-trace" });

    // Test that timeoutMs parameter is accepted and command completes normally with default timeout
    const result = await git.runGitCommand(["log", "--oneline", "-n", "1"], {
      timeoutMs: 5000, // Reasonable timeout
    });

    assert(typeof result.exitCode === "number");
    assert(result.exitCode === 0);
    assert(result.output.includes("Initial commit"));
  } finally {
    await cleanup();
  }
});

Deno.test("GitService: handles repository corruption gracefully", async () => {
  const { repoDir, cleanup, git } = await createGitTestContext("git-test-corruption-");
  const _helper = new GitTestHelper(repoDir);

  try {
    // Initialize repository
    await git.ensureRepository();
    await git.ensureIdentity();

    // Simulate repository corruption by removing HEAD
    const headPath = join(repoDir, ".git", "HEAD");
    await Deno.remove(headPath);

    // This should classify as repository error
    await assertRejects(
      async () => {
        await git.runGitCommand(["status"]);
      },
      GitRepositoryError,
    );
  } finally {
    await cleanup();
  }
});
