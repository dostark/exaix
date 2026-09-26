/**
 * @module DenoTaskToolTest
 * @path packages/execution/tests/deno_task_test.ts
 * @description Verifies the 'run_deno_task' tool implementation (Phase 201 Step 4 rename
 *   from 'deno_task'), ensuring safe execution of project tasks defined in deno.json, and
 *   that the retired 'deno_task' name is rejected rather than silently executed.
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { cleanupTempDir, createToolRegistryForTests } from "../../tool-runtime/tests/helpers.ts";

Deno.test("ToolRegistry: run_deno_task", async (t) => {
  const tempDir = await Deno.makeTempDir();
  const registry = createToolRegistryForTests(tempDir);

  const goodFile = join(tempDir, "good.ts");
  await Deno.writeTextFile(goodFile, "export const foo = 1;\n");

  await t.step("runs fmt successfully under the canonical name", async () => {
    const result = await registry.execute("run_deno_task", { task: "fmt", path: "good.ts", args: ["--check"] });
    assertEquals(result.success, true);
  });

  await t.step("the retired deno_task name is rejected, not executed", async () => {
    const result = await registry.execute("deno_task", { task: "fmt", path: "good.ts" });
    assertEquals(result.success, false);
  });

  await cleanupTempDir(tempDir);
});
