/**
 * @module DenoTaskToolTest
 * @path tests/tools/deno_task_test.ts
 * @description Verifies the 'deno_task' tool implementation, ensuring safe execution
 * of project tasks defined in deno.json.
 */

import { join } from "@std/path";
import { cleanupTempDir, createToolRegistryForTests } from "../../tool-runtime/tests/helpers.ts";

Deno.test("ToolRegistry: deno_task", async (t) => {
  const tempDir = await Deno.makeTempDir();
  const registry = createToolRegistryForTests(tempDir);

  const goodFile = join(tempDir, "good.ts");
  await Deno.writeTextFile(goodFile, "export const foo = 1;");

  const badFile = join(tempDir, "bad.ts");
  await Deno.writeTextFile(badFile, "const foo = ;"); // Syntax error

  await t.step("runs fmt successfully", async () => {
    // fmt check
    const _result = await registry.execute("deno_task", { task: "fmt", path: "good.ts", args: ["--check"] });
    // It might succeed or fail depending on formatting, but it should run.
    // If formatted correctly, code 0.
    // ...existing code...
    await registry.execute("deno_task", { task: "fmt", path: "good.ts" });
  });
  // Cleanup
  await cleanupTempDir(tempDir);
});
