/**
 * @module RunCommandToolTest
 * @path packages/tool-runtime/tests/run_command_test.ts
 * @description Verifies the 'run_command' tool, ensuring secure shell execution
 * with strict command and argument whitelisting.
 */

import { assertEquals } from "@std/assert";
import { cleanupTempDir, createToolRegistryForTests } from "./helpers.ts";
import { ToolName } from "@exaix/core";

Deno.test("ToolRegistry: run_command", async (t) => {
  const tempDir = await Deno.makeTempDir();
  const registry = createToolRegistryForTests(tempDir);

  await t.step("executes whitelisted command (echo)", async () => {
    const result = await registry.execute(ToolName.RUN_COMMAND, {
      command: "echo",
      args: ["Hello", "World"],
    });
    assertEquals(result.success, true);
    assertEquals((result.data as { output: string })?.output.trim(), "Hello World");
  });

  await t.step("blocks non-whitelisted command (rm)", async () => {
    const result = await registry.execute(ToolName.RUN_COMMAND, {
      command: "rm",
      args: ["-rf", "/"],
    });
    assertEquals(result.success, false);
    assertEquals(result.error?.includes("blocked") || result.error?.includes("not allowed"), true);
  });

  await t.step("handles command failure", async () => {
    // ls on non-existent directory usually fails with exit code
    const result = await registry.execute(ToolName.RUN_COMMAND, {
      command: "ls",
      args: ["/nonexistent_dir_12345"],
    });
    assertEquals(result.success, false);
    assertEquals(typeof result.error, "string");
  });

  // Cleanup
  await cleanupTempDir(tempDir);
});
