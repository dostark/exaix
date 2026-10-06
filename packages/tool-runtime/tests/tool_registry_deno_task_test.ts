/**
 * @module ToolRegistryDenoTaskTest
 * @path packages/tool-runtime/tests/tool_registry_deno_task_test.ts
 * @related-files ["packages/tool-runtime/src/tool_registry.ts", "packages/tool-runtime/src/deno_task_runner.ts"]
 * @architectural-layer Tests
 * @description Verifies ToolRegistry.denoTask keeps its IToolResult shapes and delegates
 *   to runDenoTask with the configured default timeout and registry base directory.
 */

import { assert, assertEquals } from "@std/assert";
import { stub } from "@std/testing/mock";
import { join } from "@std/path";
import { DEFAULT_DENO_TASK_TOOL_TIMEOUT_MS, type ISubprocessOptions, SafeSubprocess, ToolName } from "@exaix/core";
import { cleanupTempDir, createToolRegistryForTests } from "./helpers.ts";

Deno.test("[deno-task] ToolRegistry.denoTask keeps its IToolResult shapes for pass, fail and invalid task", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "tool-registry-denotask-" });
  const registry = createToolRegistryForTests(tempDir);
  try {
    await Deno.writeTextFile(join(tempDir, "ok.ts"), "export const ok = 1;\n");
    const pass = await registry.execute(ToolName.DENO_TASK, { task: "lint", path: tempDir });
    assert(pass.success, pass.error);

    await Deno.writeTextFile(join(tempDir, "bad.ts"), "const value: any = 1;\n");
    const fail = await registry.execute(ToolName.DENO_TASK, { task: "lint", path: join(tempDir, "bad.ts") });
    assert(!fail.success);
    assert((fail.data as { exitCode?: number }).exitCode !== 0, JSON.stringify(fail.data));
    assert(fail.error?.includes("failed with exit code"), fail.error);

    const invalid = await registry.execute(ToolName.DENO_TASK, { task: "deploy" });
    assert(!invalid.success);
    assert(invalid.error?.includes("Invalid task"), invalid.error);
  } finally {
    await cleanupTempDir(tempDir);
  }
});

Deno.test("[deno-task] a run_deno_task call without a timeout uses DEFAULT_DENO_TASK_TOOL_TIMEOUT_MS", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "tool-registry-denotimeout-" });
  const registry = createToolRegistryForTests(tempDir);
  const captured: { options?: ISubprocessOptions } = {};
  const s = stub(
    SafeSubprocess,
    "run",
    (_command: string, _args: string[], options?: ISubprocessOptions) => {
      captured.options = options;
      return Promise.resolve({ code: 0, stdout: "", stderr: "" });
    },
  );
  try {
    await Deno.writeTextFile(join(tempDir, "ok.ts"), "export const ok = 1;\n");
    const result = await registry.execute(ToolName.DENO_TASK, { task: "lint", path: tempDir });
    assert(result.success, result.error);
    assertEquals(captured.options?.cwd, tempDir);
    assertEquals(captured.options?.timeoutMs, DEFAULT_DENO_TASK_TOOL_TIMEOUT_MS);
  } finally {
    s.restore();
    await cleanupTempDir(tempDir);
  }
});
