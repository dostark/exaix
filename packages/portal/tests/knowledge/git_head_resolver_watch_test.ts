/**
 * @module GitHeadResolverWatchTest
 * @path packages/portal/tests/knowledge/git_head_resolver_watch_test.ts
 * @related-files ["packages/portal/knowledge/git_head_resolver.ts"]
 * @architectural-layer Portal
 * @description Unit tests for GitHeadResolver background git-hash watcher.
 */

import { assertEquals, assertExists } from "@std/assert";
import { GitHeadResolver } from "@exaix/portal/knowledge";
import { delay } from "@exaix/core/func";
import { GitService } from "@exaix/git";
import { createMockConfig } from "@exaix/testing";
import type { IGitServiceFactory } from "@exaix/core/types";

function createTestGitServiceFactory(repoDir: string): IGitServiceFactory {
  const config = createMockConfig(repoDir);
  return {
    createGitService: (repoPath: string, traceId: string) => new GitService({ config, repoPath, traceId }),
  };
}

async function setupGitRepo(repoDir: string): Promise<void> {
  await Deno.mkdir(repoDir, { recursive: true });
  await new Deno.Command("git", {
    args: ["init", "-b", "main"],
    cwd: repoDir,
    stdout: "null",
    stderr: "null",
  }).output();
  await new Deno.Command("git", {
    args: ["config", "user.name", "Test User"],
    cwd: repoDir,
    stdout: "null",
    stderr: "null",
  }).output();
  await new Deno.Command("git", {
    args: ["config", "user.email", "test@example.com"],
    cwd: repoDir,
    stdout: "null",
    stderr: "null",
  }).output();
  await new Deno.Command("git", {
    args: ["commit", "--allow-empty", "-m", "Initial commit"],
    cwd: repoDir,
    stdout: "null",
    stderr: "null",
  }).output();
}

Deno.test({
  name: "[GitHeadResolver] startWatching detects HEAD change after new commit on detached HEAD",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const repoDir = await Deno.makeTempDir({ prefix: "git-head-watch-" });
    try {
      await setupGitRepo(repoDir);

      // Detach HEAD so that HEAD-file content changes on each commit
      await new Deno.Command("git", {
        args: ["checkout", "--detach"],
        cwd: repoDir,
        stdout: "null",
        stderr: "null",
      }).output();

      const resolver = new GitHeadResolver(createTestGitServiceFactory(repoDir));
      const initialSha = await resolver.resolve(repoDir);
      assertExists(initialSha);

      const changePromise = new Promise<{ newHash: string; prevHash: string }>(
        (resolve) => {
          resolver.startWatching(repoDir, (newHash, prevHash) => {
            resolve({ newHash, prevHash });
          });
        },
      );

      // Give the watcher time to initialize and resolve the initial hash
      await delay(300);

      // Make a new commit on detached HEAD — this updates .git/HEAD in-place
      await new Deno.Command("git", {
        args: ["commit", "--allow-empty", "-m", "Second commit"],
        cwd: repoDir,
        stdout: "null",
        stderr: "null",
      }).output();

      // Wait for watcher to detect the change (debounce is 100ms)
      const result = await Promise.race([
        changePromise,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Timeout: HEAD change not detected")), 5000)
        ),
      ]);

      assertEquals(result.newHash !== initialSha, true);
      assertEquals(result.prevHash, initialSha);

      resolver.stopWatching();
    } finally {
      await Deno.remove(repoDir, { recursive: true }).catch(() => {});
    }
  },
});

Deno.test({
  name: "[GitHeadResolver] startWatching does not fire on no-op",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const repoDir = await Deno.makeTempDir({ prefix: "git-head-watch-" });
    try {
      await setupGitRepo(repoDir);

      await new Deno.Command("git", {
        args: ["checkout", "--detach"],
        cwd: repoDir,
        stdout: "null",
        stderr: "null",
      }).output();

      const resolver = new GitHeadResolver();

      let callCount = 0;
      resolver.startWatching(repoDir, () => {
        callCount++;
      });

      await delay(300);

      // No git operations — callback should not fire
      assertEquals(callCount, 0);

      resolver.stopWatching();
    } finally {
      await Deno.remove(repoDir, { recursive: true }).catch(() => {});
    }
  },
});

Deno.test({
  name: "[GitHeadResolver] startWatching toggles cleanly on same path",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const repoDir = await Deno.makeTempDir({ prefix: "git-head-watch-" });
    try {
      await setupGitRepo(repoDir);

      await new Deno.Command("git", {
        args: ["checkout", "--detach"],
        cwd: repoDir,
        stdout: "null",
        stderr: "null",
      }).output();

      const resolver = new GitHeadResolver();

      // Start and stop — no error
      resolver.startWatching(repoDir, () => {});
      await delay(100);
      resolver.stopWatching();

      // Start again — should work
      resolver.startWatching(repoDir, () => {});
      await delay(100);
      resolver.stopWatching();
    } finally {
      await Deno.remove(repoDir, { recursive: true }).catch(() => {});
    }
  },
});

Deno.test({
  name: "[GitHeadResolver] startWatching returns silently on non-git directory",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const dir = await Deno.makeTempDir({ prefix: "non-git-watch-" });
    try {
      const resolver = new GitHeadResolver();
      let callCount = 0;

      // Should not throw; should not fire callback
      resolver.startWatching(dir, () => {
        callCount++;
      });
      await delay(200);

      assertEquals(callCount, 0);
      resolver.stopWatching();
    } finally {
      await Deno.remove(dir, { recursive: true }).catch(() => {});
    }
  },
});
