/**
 * @module FileOpsToolTest
 * @path packages/tool-runtime/tests/file_ops_test.ts
 * @description Verifies the core file manipulation tools, including safe reading,
 * writing, and listing of project assets.
 */

import { assertEquals } from "@std/assert";
import { cleanupTempDir, createToolRegistryForTests } from "./helpers.ts";
import { ToolName } from "@exaix/core";

Deno.test("ToolRegistry: core file operations", async (t) => {
  const tempDir = await Deno.makeTempDir();
  const registry = createToolRegistryForTests(tempDir);

  await t.step("write_file and read_file", async () => {
    const filePath = "test.txt";
    const content = "Hello Exaix!";

    // Write
    const writeResult = await registry.execute(ToolName.WRITE_FILE, { path: filePath, content });
    assertEquals(writeResult.success, true);

    // Read
    const readResult = await registry.execute(ToolName.READ_FILE, { path: filePath });
    assertEquals(readResult.success, true);
    assertEquals((readResult.data as { content: string })?.content, content);
  });

  await t.step("create_directory and list_directory", async () => {
    const dirPath = "nested/dir";

    // Create
    const createResult = await registry.execute(ToolName.CREATE_DIRECTORY, { path: dirPath });
    assertEquals(createResult.success, true);

    // List
    const listResult = await registry.execute(ToolName.LIST_DIRECTORY, { path: "nested" });
    assertEquals(listResult.success, true);
    const data = listResult.data as { entries: { name: string; isDirectory: boolean }[] };
    assertEquals(data?.entries.some((e) => e.name === "dir" && e.isDirectory), true);
  });

  await t.step(ToolName.SEARCH_FILES, async () => {
    await registry.execute(ToolName.WRITE_FILE, { path: "search1.ts", content: "" });
    await registry.execute(ToolName.WRITE_FILE, { path: "search2.ts", content: "" });
    await registry.execute(ToolName.WRITE_FILE, { path: "other.md", content: "" });

    const result = await registry.execute(ToolName.SEARCH_FILES, { pattern: "*.ts", path: "." });
    assertEquals(result.success, true);
    const data = result.data as { files: string[] };
    assertEquals(data?.files.length >= 2, true);
    assertEquals(data?.files.some((f: string) => f.endsWith("search1.ts")), true);
    assertEquals(data?.files.some((f: string) => f.endsWith("search2.ts")), true);
  });

  await t.step("security restrictions", async () => {
    // Rejects outside path
    const result = await registry.execute(ToolName.READ_FILE, { path: "../outside.txt" });
    assertEquals(result.success, false);
    assertEquals(result.error?.includes("Access denied"), true);
  });

  // Cleanup
  await cleanupTempDir(tempDir);
});
