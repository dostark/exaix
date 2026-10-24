/**
 * @module VerificationDiffSecurityTest
 * @path packages/git/tests/verification_diff_security_test.ts
 * @description Security cases for the strict verification Git queries: attributes, diff drivers,
 *   literal pathspecs and non-regular sources.
 * @architectural-layer Test
 * @dependencies [@std/assert, @exaix/git, @exaix/git/testing]
 * @related-files [packages/git/src/git_queries.ts]
 */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { createGitTestContext, setupGitRepo } from "@exaix/git/testing";
import { readBlobAtCommit, readChangedLineRanges, readHeadSha } from "@exaix/git";

const QUERY_BUDGET = 1_000_000;

async function commitAll(git: { runGitCommand(args: string[]): Promise<unknown> }, message: string): Promise<string> {
  await git.runGitCommand(["add", "-A"]);
  await git.runGitCommand(["commit", "-m", message]);
  return await readHeadSha(git as never);
}

Deno.test("[security] a changed attribute cannot hide changed TypeScript lines", async () => {
  const { repoDir, git, cleanup } = await createGitTestContext("git-diff-attributes-");
  try {
    await setupGitRepo(repoDir, { initialCommit: true });
    await Deno.writeTextFile(join(repoDir, ".gitattributes"), "*.ts -diff\n");
    await Deno.writeTextFile(join(repoDir, "seed.ts"), "export const one = 1;\nexport const two = 2;\n");
    const base = await commitAll(git, "seed");

    await Deno.writeTextFile(join(repoDir, "seed.ts"), "export const one = 1;\nexport const two = 3;\n");
    const target = await commitAll(git, "change");

    const ranges = await readChangedLineRanges(git, base, target, "seed.ts", { maxOutputBytes: QUERY_BUDGET });
    assert(ranges.ok, "the query succeeds despite the attribute");
    assertEquals(ranges.value, [{ start: 2, end: 2 }]);
  } finally {
    await cleanup();
  }
});

Deno.test("[security] a configured diff driver never runs during verification queries", async () => {
  const { tempDir, repoDir, git, cleanup } = await createGitTestContext("git-diff-driver-");
  try {
    await setupGitRepo(repoDir, { initialCommit: true });
    const sentinel = join(tempDir, "driver-ran");
    const driver = join(tempDir, "sentinel-driver.sh");
    await Deno.writeTextFile(driver, `#!/bin/sh\ntouch "${sentinel}"\ncat "$1"\n`);
    await Deno.chmod(driver, 0o755);
    await git.runGitCommand(["config", "diff.sentinel.textconv", driver]);
    await Deno.writeTextFile(join(repoDir, ".gitattributes"), "*.ts diff=sentinel\n");
    await Deno.writeTextFile(join(repoDir, "seed.ts"), "export const one = 1;\n");
    const base = await commitAll(git, "seed");

    await Deno.writeTextFile(join(repoDir, "seed.ts"), "export const one = 2;\n");
    const target = await commitAll(git, "change");

    const ranges = await readChangedLineRanges(git, base, target, "seed.ts", { maxOutputBytes: QUERY_BUDGET });
    assert(ranges.ok);
    assertEquals(ranges.value, [{ start: 1, end: 1 }]);
    let driverRan = true;
    try {
      await Deno.stat(sentinel);
    } catch {
      driverRan = false;
    }
    assertEquals(driverRan, false);
  } finally {
    await cleanup();
  }
});

Deno.test("[security] a literal pathspec cannot broaden the changed-line query", async () => {
  const { repoDir, git, cleanup } = await createGitTestContext("git-diff-pathspec-");
  try {
    await setupGitRepo(repoDir, { initialCommit: true });
    await Deno.writeTextFile(join(repoDir, "a.ts"), "export const a = 1;\n");
    await Deno.writeTextFile(join(repoDir, "b.ts"), "export const b = 1;\n");
    await Deno.writeTextFile(join(repoDir, "[ab].ts"), "export const c = 1;\n");
    const base = await commitAll(git, "seed");

    await Deno.writeTextFile(join(repoDir, "a.ts"), "export const a = 2;\n");
    await Deno.writeTextFile(join(repoDir, "b.ts"), "export const b = 2;\n");
    await Deno.writeTextFile(join(repoDir, "[ab].ts"), "export const c = 2;\n");
    const target = await commitAll(git, "change");

    const a = await readChangedLineRanges(git, base, target, "a.ts", { maxOutputBytes: QUERY_BUDGET });
    assert(a.ok);
    assertEquals(a.value, [{ start: 1, end: 1 }]);

    const literal = await readChangedLineRanges(git, base, target, "[ab].ts", { maxOutputBytes: QUERY_BUDGET });
    assert(literal.ok);
    assertEquals(literal.value, [{ start: 1, end: 1 }]);
  } finally {
    await cleanup();
  }
});

Deno.test("[security] a selected symlink source is a categorical error", async () => {
  const { repoDir, git, cleanup } = await createGitTestContext("git-diff-symlink-");
  try {
    await setupGitRepo(repoDir, { initialCommit: true });
    await Deno.writeTextFile(join(repoDir, "real.ts"), "export const real = 1;\n");
    await Deno.symlink("real.ts", join(repoDir, "link.ts"));
    const target = await commitAll(git, "symlink");

    const blob = await readBlobAtCommit(git, target, "link.ts", { maxBytes: QUERY_BUDGET });
    assert(!blob.ok, "a symlink is not a lintable source");
    assertEquals(blob.ok ? "" : blob.code, "invalid_mode");

    const regular = await readBlobAtCommit(git, target, "real.ts", { maxBytes: QUERY_BUDGET });
    assert(regular.ok);
    assertEquals(new TextDecoder().decode(regular.value.bytes), "export const real = 1;\n");
    assertEquals(regular.value.mode, "100644");
  } finally {
    await cleanup();
  }
});
