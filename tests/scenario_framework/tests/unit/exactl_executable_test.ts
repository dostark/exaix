/**
 * @module ExactlExecutableTest
 * @path tests/scenario_framework/tests/unit/exactl_executable_test.ts
 * @description Proves that a scenario step runs the exactl of its own checkout, so a scenario run never reaches the exactl that another checkout installed on PATH.
 * @architectural-layer Test
 * @dependencies [@std/assert, @std/path]
 * @related-files ["tests/scenario_framework/runner/synthetic_runner.ts", "tests/scenario_framework/bin/exactl"]
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { CHECKOUT_EXACTL, resolveExactlExecutable } from "../../runner/synthetic_runner.ts";

Deno.test("[exactl executable] the checkout wrapper is an existing file of this repository", () => {
  assertEquals(Deno.statSync(CHECKOUT_EXACTL).isFile, true);
});

Deno.test("[exactl executable] the first candidate that is a file wins, and a directory or a missing path is skipped", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const file = join(dir, "exactl");
    await Deno.writeTextFile(file, "#!/bin/sh\n");
    assertEquals(resolveExactlExecutable([dir, join(dir, "absent"), file, CHECKOUT_EXACTL]), file);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("[exactl executable] without a usable candidate no executable is chosen, so the PATH one stays the fallback", () => {
  assertEquals(resolveExactlExecutable(["/nonexistent/exactl"]), undefined);
});
