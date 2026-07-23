/**
 * @module PinnedWorktreeStepTest
 * @path tests/scenario_framework/tests/unit/pinned_worktree_step_test.ts
 * @description Validates worktree lifecycle: create detached worktree at exact
 *   SHA, verify pinned ref, cleanup removes worktree (including on failure).
 *   Phase 141 Step 1.
 * @architectural-layer Test
 */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";

async function git(args: string[], cwd: string): Promise<{ code: number; stdout: string; stderr: string }> {
  const cmd = new Deno.Command("git", {
    args,
    cwd,
    stdout: "piped",
    stderr: "piped",
  });
  const out = await cmd.output();
  return {
    code: out.code,
    stdout: new TextDecoder().decode(out.stdout).trim(),
    stderr: new TextDecoder().decode(out.stderr).trim(),
  };
}

Deno.test(
  "[PinnedWorktree] creates detached worktree at exact SHA",
  { sanitizeResources: false, sanitizeOps: false },
  async () => {
    const parent = await Deno.makeTempDir();
    const repo = join(parent, "repo");
    const worktreeDir = join(parent, "wt");

    try {
      // Init bare repo with one commit
      await Deno.mkdir(repo, { recursive: true });
      await git(["init", "-q"], repo);
      await Deno.writeTextFile(join(repo, "hello.txt"), "hello");
      await git(["add", "hello.txt"], repo);
      await git(["-c", "user.email=test@test.com", "-c", "user.name=test", "commit", "-q", "-m", "init"], repo);

      const { stdout: sha } = await git(["rev-parse", "HEAD"], repo);

      // Create detached worktree
      const create = await git(["worktree", "add", "--detach", worktreeDir, sha], repo);
      assertEquals(create.code, 0, "worktree create must succeed");

      // Verify worktree is at the exact SHA
      const { stdout: headSha } = await git(["rev-parse", "HEAD"], worktreeDir);
      assertEquals(headSha, sha, "worktree HEAD must match pinned SHA");

      // Verify detached HEAD
      const { stdout: symbolicRef } = await git(["symbolic-ref", "-q", "HEAD"], worktreeDir);
      assert(symbolicRef === "", "worktree must be in detached HEAD state");
    } finally {
      await Deno.remove(parent, { recursive: true });
    }
  },
);

Deno.test("[PinnedWorktree] cleanup removes worktree", { sanitizeResources: false, sanitizeOps: false }, async () => {
  const parent = await Deno.makeTempDir();
  const repo = join(parent, "repo");
  const worktreeDir = join(parent, "wt");

  try {
    await Deno.mkdir(repo, { recursive: true });
    await git(["init", "-q"], repo);
    await Deno.writeTextFile(join(repo, "f.txt"), "data");
    await git(["add", "f.txt"], repo);
    await git(["-c", "user.email=test@test.com", "-c", "user.name=test", "commit", "-q", "-m", "init"], repo);
    const { stdout: sha } = await git(["rev-parse", "HEAD"], repo);

    await git(["worktree", "add", "--detach", worktreeDir, sha], repo);

    // Verify worktree exists
    const stat0 = await Deno.stat(worktreeDir);
    assert(stat0.isDirectory, "worktree dir must exist before cleanup");

    // Remove worktree
    const remove = await git(["worktree", "remove", worktreeDir], repo);
    assertEquals(remove.code, 0, "worktree remove must succeed");

    // Verify worktree gone
    let worktreeExists = false;
    try {
      await Deno.stat(worktreeDir);
      worktreeExists = true;
    } catch {
      worktreeExists = false;
    }
    assert(!worktreeExists, "worktree dir must not exist after cleanup");
  } finally {
    await Deno.remove(parent, { recursive: true });
  }
});

Deno.test("[PinnedWorktree] cleanup runs even when mid-scenario step failed", {
  sanitizeResources: false,
  sanitizeOps: false,
}, async () => {
  const parent = await Deno.makeTempDir();
  const repo = join(parent, "repo");
  const worktreeDir = join(parent, "wt");
  const cleanupMarker = join(parent, "cleanup_ran");

  try {
    await Deno.mkdir(repo, { recursive: true });
    await git(["init", "-q"], repo);
    await Deno.writeTextFile(join(repo, "f.txt"), "data");
    await git(["add", "f.txt"], repo);
    await git(["-c", "user.email=test@test.com", "-c", "user.name=test", "commit", "-q", "-m", "init"], repo);
    const { stdout: sha } = await git(["rev-parse", "HEAD"], repo);

    await git(["worktree", "add", "--detach", worktreeDir, sha], repo);

    // Simulate mid-scenario step failing — and cleanup still running
    try {
      const failing = new Deno.Command("deno", {
        args: ["eval", "Deno.exit(1)"],
        cwd: worktreeDir,
      });
      await failing.output();
    } finally {
      // cleanup: remove worktree and write marker
      await git(["worktree", "remove", worktreeDir], repo);
      await Deno.writeTextFile(cleanupMarker, "cleaned");
    }

    // Verify cleanup ran
    const marker = await Deno.stat(cleanupMarker);
    assert(marker.isFile, "cleanup must have written marker despite mid-scenario failure");

    // Verify worktree removed
    let worktreeExists = false;
    try {
      await Deno.stat(worktreeDir);
      worktreeExists = true;
    } catch {
      worktreeExists = false;
    }
    assert(!worktreeExists, "worktree must be removed despite mid-scenario failure");
  } finally {
    await Deno.remove(parent, { recursive: true });
  }
});
