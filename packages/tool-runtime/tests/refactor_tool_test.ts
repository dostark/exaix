/**
 * @module RefactorToolTest
 * @path tests/tools/refactor_tool_test.ts
 * @description Verifies specialized refactoring tools, ensuring stable execution
 * of complex symbol renaming and structural code changes.
 */

import { assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { cleanupTempDir, createToolRegistryForTests } from "./helpers.ts";
import { ToolName } from "@exaix/core";

Deno.test("ToolRegistry: refactoring tools", async (t) => {
  const tempDir = await Deno.makeTempDir();
  const registry = createToolRegistryForTests(tempDir);

  await t.step(ToolName.MOVE_FILE, async (t) => {
    const src = join(tempDir, "move_src.txt");
    const dest = join(tempDir, "move_dest.txt");
    await Deno.writeTextFile(src, "content");

    await t.step("moves file successfully", async () => {
      const result = await registry.execute(ToolName.MOVE_FILE, {
        source: "move_src.txt",
        destination: "move_dest.txt",
      });
      assertEquals(result.success, true);
      assertEquals(await Deno.readTextFile(dest), "content");
      await assertRejects(() => Deno.stat(src));
    });

    await t.step("fails if destination exists and overwrite=false", async () => {
      // dest exists from previous step
      await Deno.writeTextFile(src, "new content");
      const result = await registry.execute(ToolName.MOVE_FILE, {
        source: "move_src.txt",
        destination: "move_dest.txt",
        overwrite: false,
      });
      assertEquals(result.success, false);
      assertEquals(result.error?.includes("already exists"), true);
    });

    await t.step("overwrites if overwrite=true", async () => {
      const result = await registry.execute(ToolName.MOVE_FILE, {
        source: "move_src.txt",
        destination: "move_dest.txt",
        overwrite: true,
      });
      assertEquals(result.success, true);
      assertEquals(await Deno.readTextFile(dest), "new content");
    });
  });

  await t.step(ToolName.COPY_FILE, async (t) => {
    const src = join(tempDir, "copy_src.txt");
    const dest = join(tempDir, "copy_dest.txt");
    await Deno.writeTextFile(src, "copy me");

    await t.step("copies file successfully", async () => {
      const result = await registry.execute(ToolName.COPY_FILE, {
        source: "copy_src.txt",
        destination: "copy_dest.txt",
      });
      assertEquals(result.success, true);
      assertEquals(await Deno.readTextFile(dest), "copy me");
      assertEquals(await Deno.readTextFile(src), "copy me"); // Source still exists
    });

    await t.step("fails if destination exists and overwrite=false", async () => {
      const result = await registry.execute(ToolName.COPY_FILE, {
        source: "copy_src.txt",
        destination: "copy_dest.txt",
        overwrite: false,
      });
      assertEquals(result.success, false);
      assertEquals(result.error?.includes("already exists"), true);
    });
  });

  await t.step("delete_file", async () => {
    const file = join(tempDir, "delete_me.txt");
    await Deno.writeTextFile(file, "bye");

    const result = await registry.execute("delete_file", { path: "delete_me.txt" });
    assertEquals(result.success, true);
    await assertRejects(() => Deno.stat(file));
  });

  await t.step("path security", async () => {
    // Try to access outside tempDir (assuming tempDir is safe root)
    // PathResolver restricts to allowed roots. tempDir IS the root here.
    const result = await registry.execute("delete_file", { path: "../outside" });
    assertEquals(result.success, false);
    assertEquals(result.error?.includes("Access denied"), true);
  });

  // Cleanup
  await cleanupTempDir(tempDir);
});
