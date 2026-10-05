/**
 * @module GitServiceDestructiveArgsTest
 * @path packages/git/tests/git_service_destructive_args_test.ts
 * @description The destructive-operation guard reads the git subcommand and its flags,
 *   not free text such as a commit message.
 * @architectural-layer Test
 * @related-files [packages/git/src/git_service.ts]
 */

import { assert, assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { createGitTestContext, setupGitRepo } from "@exaix/git/testing";
import { GitSecurityError } from "@exaix/git";

// A real delegate summary that a step commit carried on 2026-10-05.
const SUMMARY_WITH_TRIGGER_WORDS = "deno lint and deno check clean. Covers N-day and due-date cases. " +
  "Rollback: git reset --hard is not needed.";

Deno.test("[git-security] a commit message that mentions clean, -d and reset --hard is allowed", async () => {
  const { repoDir, git, cleanup } = await createGitTestContext("git-destructive-msg-");
  try {
    await setupGitRepo(repoDir, { initialCommit: true });
    await Deno.writeTextFile(join(repoDir, "note.txt"), "x\n");
    await git.runGitCommand(["add", "note.txt"]);

    assertEquals(git.validateArgs(["commit", "-m", SUMMARY_WITH_TRIGGER_WORDS]).valid, true);
    const result = await git.runGitCommand(["commit", "-m", SUMMARY_WITH_TRIGGER_WORDS]);
    assertEquals(result.exitCode, 0);
  } finally {
    await cleanup();
  }
});

Deno.test("[git-security] reset --hard and clean with -f or -d stay prohibited", async () => {
  const { git, cleanup } = await createGitTestContext("git-destructive-cmd-");
  try {
    for (const args of [["reset", "--hard", "HEAD"], ["clean", "-fd"], ["clean", "-d"], ["clean", "--force"]]) {
      const verdict = git.validateArgs(args);
      assertEquals(verdict.valid, false, `git ${args.join(" ")} must be refused`);
      assert(verdict.reason?.startsWith("Destructive git operation prohibited"));
      await assertRejects(() => git.runGitCommand(args), GitSecurityError);
    }
  } finally {
    await cleanup();
  }
});

Deno.test("[git-security] a dry-run clean is not destructive", async () => {
  const { git, cleanup } = await createGitTestContext("git-destructive-dry-");
  try {
    assertEquals(git.validateArgs(["clean", "-n"]).valid, true);
  } finally {
    await cleanup();
  }
});
