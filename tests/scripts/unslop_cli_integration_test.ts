/**
 * @module UnslopCliIntegrationTest
 * @path tests/scripts/unslop_cli_integration_test.ts
 * @description The real constant-restatement task keeps its scoped read/env grants and descriptor input.
 * @architectural-layer Tooling
 * @dependencies [@std/assert, @std/path]
 * @related-files [packages/lint-policy/unslop.project.ts]
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl, join } from "@std/path";

const REPO_ROOT = fromFileUrl(new URL("../../", import.meta.url));

Deno.test("constant_restatement_descriptor_preserves_scoped_permissions", async () => {
  const config = JSON.parse(await Deno.readTextFile(join(REPO_ROOT, "deno.json"))) as {
    tasks: Record<string, string>;
  };
  const task = config.tasks["check:constant-restatement"];
  assertStringIncludes(task, "--allow-read");
  assertStringIncludes(task, "--allow-env");
  assertStringIncludes(task, "--descriptor=packages/lint-policy/unslop.project.ts");
  const result = await new Deno.Command(Deno.execPath(), {
    args: ["task", "check:constant-restatement"],
    cwd: REPO_ROOT,
    stdout: "piped",
    stderr: "piped",
  }).output();
  assertEquals(result.code, 0, new TextDecoder().decode(result.stderr));
});
