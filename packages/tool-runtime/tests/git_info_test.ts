/**
 * @module GitInfoToolTest
 * @path tests/tools/git_info_test.ts
 * @description Verifies the 'git_info' tool, ensuring that agents can correctly
 * introspect repository state, status, and history.
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { cleanupTempDir, createToolRegistryForTests } from "./helpers.ts";

Deno.test("ToolRegistry: git_info", async (t) => {
  const tempDir = await Deno.makeTempDir();
  const registry = createToolRegistryForTests(tempDir);

  // Init git repo
  const runGit = async (args: string[]) => {
    const cmd = new Deno.Command("git", {
      args,
      cwd: tempDir,
    });
    await cmd.output();
  };

  await runGit(["init"]);
  await runGit(["config", "user.email", "test@example.com"]);
  await runGit(["config", "user.name", "Test User"]);

  await t.step("branch scope", async () => {
    // Initial branch might be "main" or "master" depending on git config,
    // but usually "master" in older git or "main" in newer.
    // Let's force it to "main"
    await runGit(["checkout", "-b", "main"]);

    const result = await registry.execute("git_info", { repo_path: tempDir, scope: "branch" });
    assertEquals(result.success, true);
    assertEquals(result.data, "main");
  });

  await t.step("status scope", async () => {
    const file = join(tempDir, "test.txt");
    await Deno.writeTextFile(file, "content");

    const result = await registry.execute("git_info", { repo_path: tempDir, scope: "status" });
    assertEquals(result.success, true);
    // Should be untracked: ?? test.txt
    const status = result.data as Array<{ status: string; file: string }>;
    assertEquals(status.length, 1);
    assertEquals(status[0].status, "??");
    assertEquals(status[0].file, "test.txt");

    // Add file
    await runGit(["add", "test.txt"]);
    const result2 = await registry.execute("git_info", { repo_path: tempDir, scope: "status" });
    const status2 = result2.data as Array<{ status: string; file: string }>;
    assertEquals(status2[0].status, "A "); // Added to index
  });

  await t.step("diff_summary scope", async () => {
    await runGit(["commit", "-m", "initial"]);
    const file = join(tempDir, "test.txt");
    await Deno.writeTextFile(file, "changed content");

    const result = await registry.execute("git_info", { repo_path: tempDir, scope: "diff_summary" });
    assertEquals(result.success, true);
    // Output should contain "test.txt" and "1 file changed"
    const summary = result.data as string;
    assertEquals(summary.includes("test.txt"), true);
    assertEquals(summary.includes("1 file changed"), true);
  });

  await t.step("fails on non-git dir", async () => {
    // Remove .git to make it not a git repo
    await Deno.remove(join(tempDir, ".git"), { recursive: true });

    // We can use tempDir directly now as it is no longer a git repo
    const result = await registry.execute("git_info", { repo_path: tempDir });
    assertEquals(result.success, false);
    assertEquals(result.error?.includes("Not a git repository"), true);
  });

  // Cleanup
  await cleanupTempDir(tempDir);
});
