/**
 * @module GitHeadResolverTest
 * @path packages/portal/knowledge/tests/git_head_resolver_test.ts
 * @related-files []
 * @architectural-layer Portal
 * @description Unit tests for GitHeadResolver to ensure git SHA resolution and changed-file detection.
 */

import { assertEquals, assertMatch } from "@std/assert";
import { join } from "@std/path";
import { GitHeadResolver } from "@exaix/portal/knowledge";
import { createMockConfig } from "@exaix/testing";
import { createGitServiceFactory, setupGitRepo } from "@exaix/git/testing";

Deno.test("[GitHeadResolver] resolves HEAD SHA in a git repo", async () => {
  const repoDir = await Deno.makeTempDir();
  try {
    await setupGitRepo(repoDir, { initialCommit: true });

    const resolver = new GitHeadResolver(createGitServiceFactory(createMockConfig(repoDir)));
    const sha = await resolver.resolve(repoDir);

    assertMatch(sha ?? "", /^[0-9a-f]{40}$/);
  } finally {
    await Deno.remove(repoDir, { recursive: true });
  }
});

Deno.test("[GitHeadResolver] returns empty changed files when HEAD has no diff", async () => {
  const repoDir = await Deno.makeTempDir();
  try {
    await setupGitRepo(repoDir, { initialCommit: true });

    const resolver = new GitHeadResolver(createGitServiceFactory(createMockConfig(repoDir)));
    const sha = await resolver.resolve(repoDir);
    assertMatch(sha ?? "", /^[0-9a-f]{40}$/);

    const changes = await resolver.changedFilesSince(repoDir, sha ?? "");
    assertEquals(changes, []);
  } finally {
    await Deno.remove(repoDir, { recursive: true });
  }
});

Deno.test("[GitHeadResolver] detects changed files since a previous commit", async () => {
  const repoDir = await Deno.makeTempDir();
  try {
    await setupGitRepo(repoDir, { initialCommit: true });
    const initialSha = await new GitHeadResolver(createGitServiceFactory(createMockConfig(repoDir))).resolve(repoDir);

    await Deno.writeTextFile(join(repoDir, "new-file.txt"), "hello world\n");
    await new Deno.Command("git", {
      args: ["add", "new-file.txt"],
      cwd: repoDir,
      stdout: "null",
      stderr: "null",
    }).output();
    await new Deno.Command("git", {
      args: ["commit", "-m", "Add new file"],
      cwd: repoDir,
      stdout: "null",
      stderr: "null",
    }).output();

    const resolver = new GitHeadResolver(createGitServiceFactory(createMockConfig(repoDir)));
    const changedFiles = await resolver.changedFilesSince(repoDir, initialSha ?? "");

    assertEquals(changedFiles, ["new-file.txt"]);
  } finally {
    await Deno.remove(repoDir, { recursive: true });
  }
});

Deno.test("[GitHeadResolver] returns null for non-git directories", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const resolver = new GitHeadResolver();
    const sha = await resolver.resolve(dir);
    assertEquals(sha, null);

    const changes = await resolver.changedFilesSince(dir, "0000000000000000000000000000000000000000");
    assertEquals(changes, null);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
