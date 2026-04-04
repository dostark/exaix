/**
 * @module E2EToolTest
 * @path tests/tools/e2e_tool_test.ts
 * @description Verifies the specialized E2E workflow tools, ensuring correct
 * coordination between agent actions and multi-step verification triggers.
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { stub } from "@std/testing/mock";
import { cleanupTempDir, createToolRegistryForTests } from "./helpers.ts";
import { ToolName } from "../../src/shared/enums.ts";

Deno.test("ToolRegistry: E2E Workflow", async (t) => {
  const tempDir = await Deno.makeTempDir();
  const registry = createToolRegistryForTests(tempDir, {
    tools: {
      fetch_url: { enabled: true, allowed_domains: ["example.com"] },
      grep_search: { max_results: 100 },
    },
  });

  // 1. Setup Git
  const runGit = async (args: string[]) => {
    const cmd = new Deno.Command("git", { args, cwd: tempDir });
    await cmd.output();
  };
  await runGit(["init"]);
  await runGit(["config", "user.email", "test@example.com"]);
  await runGit(["config", "user.name", "Test User"]);

  // 2. Create initial files
  await Deno.writeTextFile(
    join(tempDir, "main.ts"),
    `
    // TODO: Implement greeting
    function greet() {
      console.log("...");
    }
  `,
  );

  await t.step("Agent explores codebase", async () => {
    // Check git status
    const status = await registry.execute("git_info", { repo_path: tempDir, scope: "status" });
    assertEquals(status.success, true);
    const files = status.data as Array<{ file: string; status: string }>;
    assertEquals(files.length, 1);
    assertEquals(files[0].file, "main.ts");

    // Search for TODOs
    const todos = await registry.execute(ToolName.GREP_SEARCH, { pattern: "TODO", path: "." });
    assertEquals(todos.success, true);
    const matches = todos.data as Array<{ file: string; line: number; content: string }>;
    assertEquals(matches.length, 1);
    assertEquals(matches[0].file, "main.ts");
    assertEquals(matches[0].content.includes("Implement greeting"), true);
  });

  await t.step("Agent learns from docs", async () => {
    // Mock fetch
    const fetchStub = stub(
      globalThis,
      "fetch",
      () => Promise.resolve(new Response("Greeting Spec: Use 'Hello World'")),
    );

    try {
      const docs = await registry.execute(ToolName.FETCH_URL, { url: "https://example.com/spec" });
      assertEquals(docs.success, true);
      assertEquals((docs.data as { content: string }).content, "Greeting Spec: Use 'Hello World'");
    } finally {
      fetchStub.restore();
    }
  });

  await t.step("Agent implements feature", async () => {
    // Patch file
    const patch = await registry.execute(ToolName.PATCH_FILE, {
      path: "main.ts",
      patches: [
        { search: 'console.log("...");', replace: 'console.log("Hello World");' },
        { search: "// TODO: Implement greeting", replace: "// Greeting implemented" },
      ],
    });
    assertEquals(patch.success, true);
    assertEquals((patch.data as { appliedCount: number }).appliedCount, 2);

    const content = await Deno.readTextFile(join(tempDir, "main.ts"));
    assertEquals(content.includes("Hello World"), true);
  });

  await t.step("Agent verifies implementation", async () => {
    // Run lint (mocked because real lint might take time or fail on new file)
    // or we can run a simple check.
    // Let's run 'deno fmt' to verify it works
    const fmt = await registry.execute("deno_task", { task: "fmt", path: "main.ts" });
    assertEquals(fmt.success, true);
  });

  await t.step("Agent refactors", async () => {
    // Move file
    const move = await registry.execute(ToolName.MOVE_FILE, { source: "main.ts", destination: "src/main.ts" });
    assertEquals(move.success, true);

    const stat = await Deno.stat(join(tempDir, "src/main.ts"));
    assertEquals(stat.isFile, true);

    // Git status should show deleted and untracked (or renamed if added)
    // We didn't add "main.ts" to git index, so it was just untracked file moved.
    // So git status should show "src/main.ts" as untracked.
    const status = await registry.execute("git_info", { repo_path: tempDir, scope: "status" });
    const files = status.data as Array<{ file: string; status: string }>;
    // Should contain src/main.ts OR src/ (if whole dir is untracked)
    const found = files.some((f) => f.file === "src/main.ts" || f.file === "src/" || f.file === "src");
    assertEquals(found, true);
  });

  // Cleanup
  await cleanupTempDir(tempDir);
});
