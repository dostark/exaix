/**
 * @module GitQueriesTest
 * @path packages/git/tests/git_queries_test.ts
 * @description Read-only git queries over an IGitService: the HEAD sha and the paths changed between two commits.
 * @architectural-layer Test
 * @related-files [packages/git/src/git_queries.ts]
 */

import { assert, assertEquals, assertFalse, assertMatch, assertStringIncludes } from "@std/assert";
import { stub } from "@std/testing/mock";
import { join } from "@std/path";
import { DomainEventType } from "@exaix/core/events";
import { createGitTestContext, setupGitRepo } from "@exaix/git/testing";
import {
  decodeUtf8,
  listChangedFilesBetween,
  listChangedSources,
  listTrackedFiles,
  parseHunkRanges,
  readChangedLineRanges,
  readHeadSha,
  resolveImmutableCommit,
} from "@exaix/git";

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

/** Writes one line per entry with a trailing newline. */
async function writeLines(path: string, lines: readonly string[]): Promise<void> {
  await Deno.writeTextFile(path, lines.map((line) => `${line}\n`).join(""));
}

/** Stages everything and commits, returning the new HEAD sha. */
async function commitAll(
  git: { runGitCommand(args: string[], options?: { throwOnError?: boolean }): Promise<unknown> },
  message: string,
): Promise<string> {
  await git.runGitCommand(["add", "-A"]);
  await git.runGitCommand(["commit", "-m", message]);
  return (await readHeadSha(git as never)) || "";
}

const QUERY_BUDGET = 1_000_000;

Deno.test("[git-queries] strict hunks cover additions, edits, renames, empty files and special paths", async () => {
  const { repoDir, git, cleanup } = await createGitTestContext("git-queries-strict-");
  try {
    await setupGitRepo(repoDir, { initialCommit: true });
    await Deno.mkdir(join(repoDir, "src"));
    await writeLines(join(repoDir, "src", "keep.ts"), ["one", "two", "three", "four", "five", "six", "seven"]);
    await Deno.writeTextFile(join(repoDir, "src", "old.ts"), "export const old = 1;\n");
    await Deno.writeTextFile(join(repoDir, "src", "deleted.ts"), "export const gone = 1;\n");
    const base = await commitAll(git, "seed");

    await writeLines(join(repoDir, "src", "keep.ts"), ["ONE", "two", "three", "four", "five", "six", "SEVEN"]);
    await Deno.writeTextFile(join(repoDir, "src", "added.ts"), "export const a = 1;\nexport const b = 2;\n");
    await Deno.writeTextFile(join(repoDir, "src", "empty.ts"), "");
    await git.runGitCommand(["mv", "src/old.ts", "src/renamed.ts"]);
    await Deno.remove(join(repoDir, "src", "deleted.ts"));
    const specials = ["space name.ts", 'quote"name.ts', "tab\tname.ts", "uni-é.ts", "line\nbreak.ts"];
    for (const name of specials) {
      await Deno.writeTextFile(join(repoDir, name), 'export const x = "1";\n');
    }
    const target = await commitAll(git, "change");

    const listed = await listChangedSources(git, base, target, {
      extensions: [".ts"],
      maxFiles: 512,
      maxOutputBytes: QUERY_BUDGET,
    });
    assert(listed.ok, "the discovery succeeds");
    const byPath = new Map(listed.value.map((change) => [change.path, change.status]));
    for (const name of [...specials, "src/added.ts", "src/renamed.ts", "src/empty.ts", "src/keep.ts"]) {
      assert(byPath.has(name), `discovery lists ${JSON.stringify(name)}`);
    }
    assertFalse(byPath.has("src/deleted.ts"), "a deleted source needs no lint");
    assertEquals(byPath.get("src/added.ts"), "added");
    assertEquals(byPath.get("src/keep.ts"), "modified");
    assertEquals(byPath.get("src/renamed.ts"), "added");

    const keep = await readChangedLineRanges(git, base, target, "src/keep.ts", { maxOutputBytes: QUERY_BUDGET });
    assert(keep.ok);
    assertEquals(keep.value, [{ start: 1, end: 1 }, { start: 7, end: 7 }]);

    const added = await readChangedLineRanges(git, base, target, "src/added.ts", { maxOutputBytes: QUERY_BUDGET });
    assert(added.ok);
    assertEquals(added.value, [{ start: 1, end: 2 }]);

    const empty = await readChangedLineRanges(git, base, target, "src/empty.ts", { maxOutputBytes: QUERY_BUDGET });
    assert(empty.ok);
    assertEquals(empty.value, []);

    const renamed = await readChangedLineRanges(git, base, target, "src/renamed.ts", { maxOutputBytes: QUERY_BUDGET });
    assert(renamed.ok);
    assertEquals(renamed.value, [{ start: 1, end: 1 }]);

    const special = await readChangedLineRanges(git, base, target, "space name.ts", { maxOutputBytes: QUERY_BUDGET });
    assert(special.ok);
    assertEquals(special.value, [{ start: 1, end: 1 }]);
  } finally {
    await cleanup();
  }
});

Deno.test("[git-queries] strict queries return categorical errors instead of empty fallbacks", async () => {
  const { repoDir, git, cleanup } = await createGitTestContext("git-queries-errors-");
  const empty = await createGitTestContext("git-queries-errors-nohead-");
  try {
    await setupGitRepo(repoDir, { initialCommit: true });
    await setupGitRepo(empty.repoDir);
    await writeLines(
      join(repoDir, "big.ts"),
      Array.from({ length: 400 }, (_, index) => `export const v${index} = ${index};`),
    );
    const base = await commitAll(git, "seed");
    await writeLines(
      join(repoDir, "big.ts"),
      Array.from({ length: 400 }, (_, index) => `export const w${index} = ${index};`),
    );
    const target = await commitAll(git, "change");

    const ref = await resolveImmutableCommit(git, "HEAD");
    assertFalse(ref.ok);
    assertEquals(ref.ok ? "" : ref.code, "invalid_object");

    const short = await resolveImmutableCommit(git, base.slice(0, 7));
    assertFalse(short.ok);
    assertEquals(short.ok ? "" : short.code, "invalid_object");

    const missing = await resolveImmutableCommit(git, "0".repeat(40));
    assertFalse(missing.ok);
    assertEquals(missing.ok ? "" : missing.code, "query_failed");

    const noHead = await resolveImmutableCommit(empty.git, "a".repeat(40));
    assertFalse(noHead.ok);

    const same = await listChangedSources(git, base, base, {
      extensions: [".ts"],
      maxFiles: 512,
      maxOutputBytes: QUERY_BUDGET,
    });
    assert(same.ok);
    assertEquals(same.value, []);

    const equal = await readChangedLineRanges(git, base, base, "big.ts", { maxOutputBytes: QUERY_BUDGET });
    assert(equal.ok);
    assertEquals(equal.value, []);

    assertEquals(parseHunkRanges("@@ -1,2 +1,2 @@\nexport\n"), null);
    assertEquals(parseHunkRanges("@@ -1 +1 @@\n-old\n+new\n"), [{ start: 1, end: 1 }]);

    const limited = await readChangedLineRanges(git, base, target, "big.ts", { maxOutputBytes: 64 });
    assertFalse(limited.ok);
    assertEquals(limited.ok ? "" : limited.code, "output_limit");

    assertEquals(decodeUtf8(new Uint8Array([0xff, 0xfe])), null);
    assertEquals(decodeUtf8(new TextEncoder().encode("export const ok = 1;\n")), "export const ok = 1;\n");
  } finally {
    await cleanup();
    await empty.cleanup();
  }
});

Deno.test("[git-queries] bounded capture reaps the child and categorical audit hides raw paths", async () => {
  const { repoDir, db, git, cleanup } = await createGitTestContext("git-queries-audit-");
  try {
    await setupGitRepo(repoDir, { initialCommit: true });
    await writeLines(
      join(repoDir, "big.ts"),
      Array.from({ length: 400 }, (_, index) => `export const v${index} = ${index};`),
    );
    const base = await commitAll(git, "seed");
    await writeLines(
      join(repoDir, "big.ts"),
      Array.from({ length: 400 }, (_, index) => `export const w${index} = ${index};`),
    );
    const target = await commitAll(git, "change");

    const limited = await git.runGitCommand(["diff", "-U0", base, target, "--", "big.ts"], {
      throwOnError: false,
      maxOutputBytes: 64,
      auditMode: "categorical",
    });
    assertEquals(limited.exitCode, -1);

    assertMatch(await readHeadSha(git), SHA_PATTERN);
    const ok = await git.runGitCommand(["rev-parse", "HEAD"], { auditMode: "categorical" });
    assertEquals(ok.exitCode, 0);

    const secret = "secret-token-abc.ts";
    await Deno.writeTextFile(join(repoDir, secret), "export const leak = 1;\n");
    await commitAll(git, "secret file");
    await db.waitForFlush();
    const rowsBefore = db.getActivitiesByActionType(DomainEventType.GitCommandSuccess).length;
    const failed = await git.runGitCommand(["diff", "--name-status", base, target, "--", secret], {
      throwOnError: false,
      auditMode: "categorical",
    });
    assertEquals(failed.exitCode, 0);
    await db.waitForFlush();

    const rows = db.getActivitiesByActionType(DomainEventType.GitCommandSuccess).slice(rowsBefore);
    const payloads = rows.map((row) => row.payload);
    for (const payload of payloads) {
      assertFalse(payload.includes(secret), "categorical audit hides the raw path");
      assertFalse(payload.includes("git diff"), "categorical audit hides the raw argv");
      assertStringIncludes(payload, '"operation"');
    }
    assert(payloads.length > 0);
  } finally {
    await cleanup();
  }
});

Deno.test("source-containing-git-markers", async () => {
  const { repoDir, git, cleanup } = await createGitTestContext("git-markers-");
  try {
    await setupGitRepo(repoDir, { initialCommit: true });
    const base = await readHeadSha(git);
    await Deno.writeTextFile(
      join(repoDir, "markers.ts"),
      [
        'export const binary = "Binary files example";',
        'export const patch = "GIT binary patch";',
        'export const diff = "diff --git example";',
      ].join("\n") + "\n",
    );
    const target = await commitAll(git, "source markers");
    const result = await readChangedLineRanges(git, base, target, "markers.ts", { maxOutputBytes: QUERY_BUDGET });
    assert(result.ok, JSON.stringify(result));
    assertEquals(result.value, [{ start: 1, end: 3 }]);
  } finally {
    await cleanup();
  }
});

Deno.test("genuine-malformed-patch-rejected", async () => {
  for (
    const patch of [
      "@@ invalid @@\n",
      "@@ -1 +1,2 @@\n-old\n+new\n",
      "Binary files a/x.ts and b/x.ts differ\n",
      "GIT binary patch\n",
    ]
  ) {
    assertEquals(parseHunkRanges(patch), null, patch);
  }
  const { git, cleanup } = await createGitTestContext("git-bad-patch-");
  try {
    for (
      const output of [
        "not a git patch\n",
        "@@ -0,0 +1 @@\n+text\n",
        [
          "diff --git a/x.ts b/x.ts",
          "--- a/x.ts",
          "+++ b/x.ts",
          "@@ -1 +1 @@",
          "-old",
          "+new",
          "diff --git a/y.ts b/y.ts",
          "--- a/y.ts",
          "+++ b/y.ts",
          "@@ -1 +1 @@",
          "-old",
          "+new",
          "",
        ].join("\n"),
      ]
    ) {
      const command = stub(
        git,
        "runGitCommand",
        () => Promise.resolve({ output, exitCode: 0, stdoutBytes: new TextEncoder().encode(output) }),
      );
      try {
        const result = await readChangedLineRanges(git, "a".repeat(40), "b".repeat(40), "x.ts", {
          maxOutputBytes: QUERY_BUDGET,
        });
        assertEquals(result.ok, false, output);
      } finally {
        command.restore();
      }
    }
  } finally {
    await cleanup();
  }
});

Deno.test("[git-queries] listTrackedFiles returns regular tracked files only", async () => {
  const { repoDir, git, cleanup } = await createGitTestContext("git-queries-tracked-");
  try {
    await setupGitRepo(repoDir, { initialCommit: true });
    const initial = await readHeadSha(git);
    await Deno.mkdir(join(repoDir, "nested"), { recursive: true });
    await writeLines(join(repoDir, "alpha.ts"), ["a"]);
    await writeLines(join(repoDir, "nested", "beta.ts"), ["b"]);
    await writeLines(join(repoDir, "spaced name.ts"), ["c"]);
    await writeLines(join(repoDir, ".gitignore"), ["ignored.ts"]);
    await writeLines(join(repoDir, "ignored.ts"), ["d"]);
    await Deno.symlink("alpha.ts", join(repoDir, "link.ts"));
    await git.runGitCommand(["add", "-A"]);
    await git.runGitCommand(["add", "-f", "ignored.ts"]);
    await git.runGitCommand(["update-index", "--add", "--cacheinfo", `160000,${initial},submodule`]);
    await git.runGitCommand(["commit", "-m", "seed tracked files"]);
    const head = await readHeadSha(git);

    const listed = await listTrackedFiles(git, head, { maxOutputBytes: 1_048_576 });
    assertEquals(listed.ok, true);
    if (!listed.ok) return;
    assertEquals([...listed.value].sort(), [
      ".gitignore",
      "alpha.ts",
      "ignored.ts",
      "nested/beta.ts",
      "spaced name.ts",
    ]);
  } finally {
    await cleanup();
  }
});

Deno.test("[git-queries] listTrackedFiles rejects a non-full commit and a cap below the listing", async () => {
  const { repoDir, git, cleanup } = await createGitTestContext("git-queries-tracked-cap-");
  try {
    await setupGitRepo(repoDir, { initialCommit: true });
    await writeLines(join(repoDir, "alpha.ts"), ["a"]);
    await git.runGitCommand(["add", "alpha.ts"]);
    await git.runGitCommand(["commit", "-m", "add alpha"]);
    const head = await readHeadSha(git);

    assertEquals(
      await listTrackedFiles(git, "HEAD", { maxOutputBytes: 1_048_576 }),
      { ok: false, code: "invalid_object" },
    );
    assertEquals(
      await listTrackedFiles(git, head, { maxOutputBytes: 16 }),
      { ok: false, code: "output_limit" },
    );
    assertEquals((await listTrackedFiles(git, head, { maxOutputBytes: 4_096 })).ok, true);
  } finally {
    await cleanup();
  }
});
