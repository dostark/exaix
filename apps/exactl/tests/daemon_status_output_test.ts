/**
 * @module DaemonStatusOutputTest
 * @path apps/exactl/tests/daemon_status_output_test.ts
 * @description Runs `exactl daemon status` through the real binary and compares the --json and -o json outputs.
 * @architectural-layer Test
 * @dependencies [@std/assert, apps/exactl/tests/helpers/exactl_cli_process.ts]
 * @related-files [apps/exactl/src/command_builders/daemon_command.ts]
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { runExactlSequenceInTempWorkspace } from "./helpers/exactl_cli_process.ts";

Deno.test("daemon status --json and -o json print identical bytes", async () => {
  const [flag, option, human] = await runExactlSequenceInTempWorkspace([
    ["daemon", "status", "--json"],
    ["daemon", "status", "-o", "json"],
    ["daemon", "status"],
  ]);
  assertEquals(flag.code, 0, flag.stderr);
  assertEquals(option.code, 0, option.stderr);
  assertEquals(flag.stdout, option.stdout);
  const status = JSON.parse(flag.stdout) as { status: string; binary_version: string };
  assertEquals(status.status, "stopped");
  assertEquals(human.code, 0, human.stderr);
  assertStringIncludes(human.stdout, "Stopped");
});
