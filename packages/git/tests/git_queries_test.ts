/**
 * @module GitQueriesTest
 * @path packages/git/tests/git_queries_test.ts
 * @description Read-only git queries over an IGitService: the HEAD sha and the paths changed between two commits.
 * @architectural-layer Test
 * @related-files [packages/git/src/git_queries.ts]
 */

import { assertEquals, assertMatch } from "@std/assert";
import { join } from "@std/path";
import { createGitTestContext, setupGitRepo } from "@exaix/git/testing";
import { listChangedFilesBetween, readHeadSha } from "@exaix/git";

const SHA_PATTERN = /^[0-9a-f]{40}$/;

Deno.test("[git-queries] readHeadSha returns the trimmed HEAD sha of a repo with a commit", async () => {
  const { repoDir, git, cleanup } = await createGitTestContext("git-queries-head-");
  try {
    await setupGitRepo(repoDir, { initialCommit: true });
    assertMatch(await readHeadSha(git), SHA_PATTERN);
  } finally {
    await cleanup();
  }
});

Deno.test("[git-queries] readHeadSha returns an empty string when HEAD cannot be read", async () => {
  const { repoDir, git, cleanup } = await createGitTestContext("git-queries-nohead-");
  try {
    await setupGitRepo(repoDir);
    assertEquals(await readHeadSha(git), "");
  } finally {
    await cleanup();
  }
});

Deno.test("[git-queries] listChangedFilesBetween lists the paths that two commits differ by", async () => {
  const { repoDir, git, cleanup } = await createGitTestContext("git-queries-diff-");
  try {
    await setupGitRepo(repoDir, { initialCommit: true });
    const before = await readHeadSha(git);
    await Deno.writeTextFile(join(repoDir, "alpha.txt"), "a\n");
    await Deno.writeTextFile(join(repoDir, "beta.txt"), "b\n");
    await git.runGitCommand(["add", "alpha.txt", "beta.txt"]);
    await git.runGitCommand(["commit", "-m", "add two files"]);
    const after = await readHeadSha(git);

    assertEquals((await listChangedFilesBetween(git, before, after)).sort(), ["alpha.txt", "beta.txt"]);
  } finally {
    await cleanup();
  }
});

Deno.test("[git-queries] listChangedFilesBetween is empty for equal, blank or unknown shas", async () => {
  const { repoDir, git, cleanup } = await createGitTestContext("git-queries-empty-");
  try {
    await setupGitRepo(repoDir, { initialCommit: true });
    const head = await readHeadSha(git);

    assertEquals(await listChangedFilesBetween(git, head, head), []);
    assertEquals(await listChangedFilesBetween(git, "", head), []);
    assertEquals(await listChangedFilesBetween(git, head, "0".repeat(40)), []);
  } finally {
    await cleanup();
  }
});
