/**
 * @module GitHistoryAnalyzerTest
 * @path packages/portal/knowledge/tests/git_history_analyzer_test.ts
 * @description Tests for GitHistoryAnalyzer — Strategy 11 of PortalKnowledgeService.
 * Tests git command parsing, missing git repo, and actual git history extraction.
 */

// deno-lint-ignore-file no-explicit-any
import { assertEquals, assertGreaterOrEqual } from "@std/assert";
import { GIT_HISTORY_SUFFICIENT_COMMITS } from "@exaix/core";
import { GitHistoryAnalyzer } from "../git_history_analyzer.ts";

Deno.test("GitHistoryAnalyzer: parseLogAuthors parses standard format", () => {
  const analyzer = new GitHistoryAnalyzer();

  const result = (analyzer as any).parseLogAuthors("Alice\nAlice\nBob\nCharlie");

  assertEquals(result, [
    { name: "Alice", commitCount: 2 },
    { name: "Bob", commitCount: 1 },
    { name: "Charlie", commitCount: 1 },
  ]);
});

Deno.test("GitHistoryAnalyzer: parseLogAuthors handles empty input", () => {
  const analyzer = new GitHistoryAnalyzer();

  const result = (analyzer as any).parseLogAuthors("");

  assertEquals(result, []);
});

Deno.test("GitHistoryAnalyzer: parseLogAuthors handles single author", () => {
  const analyzer = new GitHistoryAnalyzer();

  const result = (analyzer as any).parseLogAuthors("Test User");

  assertEquals(result, [
    { name: "Test User", commitCount: 1 },
  ]);
});

Deno.test("GitHistoryAnalyzer: parseFileFrequencies counts correctly", () => {
  const analyzer = new GitHistoryAnalyzer();

  const result = (analyzer as any).parseFileFrequencies(
    "src/main.ts\nsrc/main.ts\nsrc/utils.ts\nsrc/main.ts\nREADME.md",
  );

  assertEquals(result, [
    { file: "src/main.ts", commitCount: 3 },
    { file: "src/utils.ts", commitCount: 1 },
    { file: "README.md", commitCount: 1 },
  ]);
});

Deno.test("GitHistoryAnalyzer: parseFileFrequencies handles empty input", () => {
  const analyzer = new GitHistoryAnalyzer();

  const result = (analyzer as any).parseFileFrequencies("");

  assertEquals(result, []);
});

Deno.test("GitHistoryAnalyzer: returns empty state when not a git repo", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const analyzer = new GitHistoryAnalyzer();

    const result = await analyzer.analyze(tempDir);

    assertEquals(result.totalCommits, 0);
    assertEquals(result.totalAuthors, 0);
    assertEquals(result.hasSufficientHistory, false);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test(
  "GitHistoryAnalyzer: hasSufficientHistory is true for totalCommits >= GIT_HISTORY_SUFFICIENT_COMMITS",
  async () => {
    const tempDir = await Deno.makeTempDir();
    try {
      await new Deno.Command("git", { args: ["init"], cwd: tempDir }).output();
      await new Deno.Command("git", {
        args: ["config", "user.email", "t@t.com"],
        cwd: tempDir,
      }).output();
      await new Deno.Command("git", {
        args: ["config", "user.name", "T"],
        cwd: tempDir,
      }).output();

      // Create exactly GIT_HISTORY_SUFFICIENT_COMMITS commits
      for (let i = 1; i <= GIT_HISTORY_SUFFICIENT_COMMITS; i++) {
        await Deno.writeTextFile(`${tempDir}/file${i}.txt`, `content ${i}`);
        await new Deno.Command("git", { args: ["add", "."], cwd: tempDir }).output();
        await new Deno.Command("git", {
          args: ["commit", "-m", `commit ${i}`],
          cwd: tempDir,
        }).output();
      }

      const result = await new GitHistoryAnalyzer().analyze(tempDir);
      assertEquals(
        result.hasSufficientHistory,
        true,
        `hasSufficientHistory should be true for ${GIT_HISTORY_SUFFICIENT_COMMITS} commits`,
      );
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  },
);

Deno.test(
  "GitHistoryAnalyzer: hasSufficientHistory is false for totalCommits < GIT_HISTORY_SUFFICIENT_COMMITS",
  async () => {
    const tempDir = await Deno.makeTempDir();
    try {
      await new Deno.Command("git", { args: ["init"], cwd: tempDir }).output();
      await new Deno.Command("git", {
        args: ["config", "user.email", "t@t.com"],
        cwd: tempDir,
      }).output();
      await new Deno.Command("git", {
        args: ["config", "user.name", "T"],
        cwd: tempDir,
      }).output();

      // One fewer than the threshold
      for (let i = 1; i < GIT_HISTORY_SUFFICIENT_COMMITS; i++) {
        await Deno.writeTextFile(`${tempDir}/file${i}.txt`, `content ${i}`);
        await new Deno.Command("git", { args: ["add", "."], cwd: tempDir }).output();
        await new Deno.Command("git", {
          args: ["commit", "-m", `commit ${i}`],
          cwd: tempDir,
        }).output();
      }

      const result = await new GitHistoryAnalyzer().analyze(tempDir);
      assertEquals(
        result.hasSufficientHistory,
        false,
        `hasSufficientHistory should be false for ${GIT_HISTORY_SUFFICIENT_COMMITS - 1} commits`,
      );
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  },
);

Deno.test("GitHistoryAnalyzer: commitLimit bounds the number of commits analyzed", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    await new Deno.Command("git", { args: ["init"], cwd: tempDir }).output();
    await new Deno.Command("git", {
      args: ["config", "user.email", "t@t.com"],
      cwd: tempDir,
    }).output();
    await new Deno.Command("git", {
      args: ["config", "user.name", "T"],
      cwd: tempDir,
    }).output();

    // 3 commits that each touch the same file
    for (let i = 1; i <= 3; i++) {
      await Deno.writeTextFile(`${tempDir}/main.ts`, `export const v = ${i};`);
      await new Deno.Command("git", { args: ["add", "."], cwd: tempDir }).output();
      await new Deno.Command("git", {
        args: ["commit", "-m", `update ${i}`],
        cwd: tempDir,
      }).output();
    }

    // Limit to only the last 1 commit
    const result = await new GitHistoryAnalyzer().analyze(tempDir, 1, "1.year");
    const mainEntry = result.topChangedFiles?.find((f) => f.file.endsWith("main.ts"));
    assertEquals(
      mainEntry?.commitCount,
      1,
      "commitLimit=1 should restrict analysis to 1 commit, so main.ts appears only once",
    );
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("GitHistoryAnalyzer: extracts history from git repo", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    await new Deno.Command("git", { args: ["init"], cwd: tempDir }).output();
    await new Deno.Command("git", { args: ["config", "user.email", "test@test.com"], cwd: tempDir }).output();
    await new Deno.Command("git", { args: ["config", "user.name", "Test User"], cwd: tempDir }).output();
    await Deno.writeTextFile(`${tempDir}/README.md`, "# Test");
    await Deno.mkdir(`${tempDir}/src`, { recursive: true });
    await Deno.writeTextFile(`${tempDir}/src/main.ts`, "export const x = 1;");
    await new Deno.Command("git", { args: ["add", "."], cwd: tempDir }).output();
    await new Deno.Command("git", { args: ["commit", "-m", "Initial commit"], cwd: tempDir }).output();

    const analyzer = new GitHistoryAnalyzer();

    const result = await analyzer.analyze(tempDir, 500, "1.year");

    assertEquals(result.totalCommits, 1);
    assertEquals(result.totalAuthors, 1);
    assertEquals(result.totalAuthors, 1);
    assertEquals(result.hasSufficientHistory, false);
    assertEquals(result.topAuthors?.length, 1);
    assertEquals(result.topAuthors?.[0].name, "Test User");
    assertEquals(result.topAuthors?.[0].commitCount, 1);
    assertGreaterOrEqual(result.topChangedFiles?.length ?? 0, 1);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});
